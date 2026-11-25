/** Saves project links and tracks their delivery to oma-agent alongside any earlier setup transcript. */

import { randomUUID } from "node:crypto";
import { z } from "zod";

import { getDb } from "@/lib/db";
import { AgentChatError, getAgentRunProgress, startAgentRun } from "./agent-chat";

const projectLinks = z.object({ websiteUrl: z.string().nullable(), githubUrl: z.string().nullable() });
const setupSchema = z.discriminatedUnion("status", [
  projectLinks.extend({ status: z.literal("done") }),
  z.object({ status: z.literal("skipped") }),
]);
const deliverySchema = z.object({ sessionId: z.uuid(), turnId: z.uuid(), runHandle: z.string().optional() });
const envelopeSchema = z.object({
  kind: z.literal("project-setup"),
  setup: setupSchema,
  agent: z.json(),
  delivery: deliverySchema.optional(),
});

export type ProjectLinks = z.infer<typeof projectLinks>;
type CompletedAnswers = Extract<z.infer<typeof setupSchema>, { status: "done" }>;
export type ProjectSetupEnvelope = z.infer<typeof envelopeSchema>;
export const projectSetupIntro = "The user submitted these project setup questions and answers.";

export function readProjectSetupEnvelope(value: unknown) {
  const result = envelopeSchema.safeParse(value);
  return result.success ? result.data : undefined;
}

export function readProjectSetup(userId: string) {
  const row = getDb().prepare("SELECT onboarding_state FROM users WHERE id = ?").get(userId);
  return row?.onboarding_state == null ? undefined : readProjectSetupEnvelope(JSON.parse(String(row.onboarding_state)));
}

export function isProjectSetupComplete(project: ProjectSetupEnvelope | undefined) {
  return project?.setup.status === "skipped" || Boolean(project?.delivery?.runHandle);
}

export function skipSavedProjectSetup(userId: string) {
  return getDb().prepare(`
    UPDATE users SET onboarding_state = json_object(
      'kind', 'project-setup', 'setup', json('{"status":"skipped"}'), 'agent', json(onboarding_state)
    )
    WHERE id = ? AND json_extract(onboarding_state, '$.kind') IS NOT 'project-setup'
  `).run(userId).changes === 1;
}

export async function sendProjectSetup(userId: string, answers: CompletedAnswers):
  Promise<{ ok: boolean }> {
  const db = getDb();
  const existing = readProjectSetup(userId);
  if (isProjectSetupComplete(existing)) return { ok: true };

  if (!existing?.delivery) {
    const delivery = { sessionId: randomUUID(), turnId: randomUUID() };

    // Store the payload and gateway idempotency key together before any network request.
    db.prepare(`
      UPDATE users SET onboarding_state = json_set(
        CASE WHEN json_extract(onboarding_state, '$.kind') = 'project-setup' THEN onboarding_state
          ELSE json_object('kind', 'project-setup', 'agent', json(onboarding_state)) END,
        '$.setup', json(?), '$.delivery', json(?)
      )
      WHERE id = ? AND (json_extract(onboarding_state, '$.kind') IS NOT 'project-setup'
        OR (json_extract(onboarding_state, '$.setup.status') = 'done' AND json_type(onboarding_state, '$.delivery') IS NULL))
    `).run(JSON.stringify(answers), JSON.stringify(delivery), userId);
  }

  const project = readProjectSetup(userId);
  if (isProjectSetupComplete(project)) return { ok: true };
  if (project?.setup.status !== "done" || !project.delivery) throw new Error("Project setup could not be prepared.");
  const { websiteUrl, githubUrl } = project.setup;
  const { sessionId, turnId } = project.delivery;
  const questions = [
    { question: "What is your website URL?", answer: websiteUrl },
    { question: "What is your GitHub URL?", answer: githubUrl },
  ];

  // A queued run reuses its original message with the same gateway idempotency key.
  const missingLink = websiteUrl === null ? "a website link" : "a GitHub link";
  const message = projectSetupIntro + " Use the links as project context. "
    + `A null answer means the user did not provide ${missingLink}.\n\n`
    + JSON.stringify(questions, null, 2);

  let handle: string;
  try {
    ({ handle } = await startAgentRun(userId, {
      sessionId,
      turnId,
      message,
    }, "default"));
  } catch (error) {
    if (!(error instanceof AgentChatError)) throw error;
    if (isProjectSetupComplete(readProjectSetup(userId))) return { ok: true };
    return { ok: false };
  }

  db.prepare(`
    UPDATE users SET onboarding_state = json_set(onboarding_state, '$.delivery.runHandle', ?)
    WHERE id = ? AND json_extract(onboarding_state, '$.delivery.turnId') = ?
      AND json_extract(onboarding_state, '$.delivery.runHandle') IS NULL
  `).run(handle, userId, turnId);
  return { ok: true };
}

/** Retry delivery or replace a confirmed terminal run, keeping the saved answers and backup transcript. */
export async function retrySavedProjectSetup(userId: string): Promise<{ error?: string }> {
  const project = readProjectSetup(userId);
  if (project?.setup.status !== "done") return { error: "Add your project links before retrying setup." };

  const previous = project.delivery;
  if (previous?.runHandle) {
    try {
      const { status } = await getAgentRunProgress(userId, previous.runHandle, "default");
      if (status !== "failed" && status !== "cancelled") {
        return { error: "Project setup can be restarted after a failed or cancelled run." };
      }
    } catch (error) {
      if (!(error instanceof AgentChatError)) throw error;
      return { error: "Couldn’t verify the last setup run. Check the oma-agent connection." };
    }

    const delivery = { sessionId: randomUUID(), turnId: randomUUID() };
    // A concurrent retry must not replace the attempt that already took over.
    const result = getDb().prepare(`
      UPDATE users SET onboarding_state = json_set(onboarding_state, '$.delivery', json(?))
      WHERE id = ? AND json_extract(onboarding_state, '$.delivery.turnId') = ?
        AND json_extract(onboarding_state, '$.delivery.runHandle') = ?
    `).run(JSON.stringify(delivery), userId, previous.turnId, previous.runHandle);
    if (!result.changes) return {};
  }

  const delivery = await sendProjectSetup(userId, project.setup);
  return delivery.ok ? {} : { error: "Your links are saved. Check the oma-agent connection and retry setup." };
}

export type ProjectFields = "websiteUrl" | "githubUrl";

function parseHttpLink(value: string) {
  if (!value || value.length > 2048 || /\s/.test(value)) return;
  const url = URL.parse(value.includes("://") ? value : "https://" + value);
  if (!url || !["http:", "https:"].includes(url.protocol) || url.username || url.password) return;
  if (url.hostname !== "localhost" && !url.hostname.includes(".") && !url.hostname.startsWith("[")) return;
  return url;
}

export function validateProjectLinks(values: Record<ProjectFields, unknown>) {
  const websiteValue = typeof values.websiteUrl === "string" ? values.websiteUrl.trim() : "";
  const website = parseHttpLink(websiteValue);
  const githubValue = typeof values.githubUrl === "string" ? values.githubUrl.trim() : "";
  const github = parseHttpLink(githubValue);
  const githubPath = github && ["github.com", "www.github.com"].includes(github.hostname)
    && !github.port && /^\/[\w-]+(?:\/[\w.-]+)?\/?$/.test(github.pathname) ? github.pathname.replace(/\/$/, "") : null;
  const errors: Partial<Record<ProjectFields, string>> = {};
  if ((websiteValue && !website) || (values.websiteUrl != null && typeof values.websiteUrl !== "string")) {
    errors.websiteUrl = "Enter a website URL, such as example.com.";
  }
  if ((githubValue && !githubPath) || (values.githubUrl != null && typeof values.githubUrl !== "string")) {
    errors.githubUrl = "Enter a GitHub repository or organization URL.";
  } else if (!websiteValue && githubPath?.split("/").length === 2) {
    errors.githubUrl = "Enter a GitHub repository URL or add a website.";
  }
  if (!errors.websiteUrl && !errors.githubUrl && !website && !githubPath) {
    errors.websiteUrl = "Enter a website URL or a GitHub repository URL.";
  }
  if (errors.websiteUrl || errors.githubUrl) return { ok: false as const, errors };
  return {
    ok: true as const,
    setup: { status: "done", websiteUrl: website?.href ?? null, githubUrl: githubPath ? "https://github.com" + githubPath : null },
  } satisfies { ok: true; setup: CompletedAnswers };
}
