/** Renders the two project questions and keeps entered URLs available when validation fails. */

"use client";

import { ArrowRight, GitFork, Globe } from "lucide-react";
import { useActionState, useState } from "react";

import { submitProjectSetup, type ProjectSetupFormState } from "@/app/actions/project-setup";
import type { ProjectLinks } from "@/lib/server/project-setup";

const emptyState: ProjectSetupFormState = {};

export function ProjectForm({ initialLinks, needsRetry }: { initialLinks?: ProjectLinks; needsRetry: boolean }) {
  const [state, action, pending] = useActionState(submitProjectSetup, emptyState);
  const [website, setWebsite] = useState(initialLinks?.websiteUrl ?? "");
  const [github, setGithub] = useState(initialLinks?.githubUrl ?? "");
  const { errors } = state;
  const readOnly = pending || needsRetry || Boolean(state.saved);
  const saved = needsRetry ? initialLinks : undefined;

  return (
    <form className="project-setup-form" action={action} aria-label="Project links" aria-busy={pending}>
      <div className="project-setup-field">
        <label htmlFor="project-website">Website URL</label>
        <div className="project-setup-input">
          <Globe size={18} aria-hidden="true" />
          <input id="project-website" name="websiteUrl" inputMode="url" autoComplete="url"
            autoCapitalize="none" spellCheck={false} maxLength={2048} placeholder="https://example.com"
            readOnly={readOnly} value={saved ? saved.websiteUrl ?? "" : website} onChange={(event) => setWebsite(event.target.value)}
            aria-invalid={Boolean(errors?.websiteUrl)} aria-describedby={errors?.websiteUrl ? "project-website-error" : undefined} />
        </div>
        {errors?.websiteUrl && <p className="project-setup-error" id="project-website-error" role="alert">{errors.websiteUrl}</p>}
      </div>
      <div className="project-setup-field">
        <label htmlFor="project-github">GitHub URL</label>
        <div className="project-setup-input">
          <GitFork size={18} aria-hidden="true" />
          <input id="project-github" name="githubUrl" inputMode="url" autoComplete="off"
            autoCapitalize="none" spellCheck={false} maxLength={2048} placeholder="https://github.com/owner/repository"
            readOnly={readOnly} value={saved ? saved.githubUrl ?? "" : github} onChange={(event) => setGithub(event.target.value)}
            aria-invalid={Boolean(errors?.githubUrl)} aria-describedby={errors?.githubUrl ? "project-github-error" : undefined} />
        </div>
        {errors?.githubUrl && <p className="project-setup-error" id="project-github-error" role="alert">{errors.githubUrl}</p>}
      </div>
      {state.message && <p className="project-setup-error" role="alert">{state.message}</p>}
      <button type="submit" className="project-setup-submit" disabled={pending}>
        {pending ? "Sending to oma-agent…" : needsRetry || state.saved ? "Retry sending" : "Open workspace"}
        <ArrowRight size={19} aria-hidden="true" />
      </button>
    </form>
  );
}
