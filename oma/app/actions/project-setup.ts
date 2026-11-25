/** Authenticates project setup submissions and opens the workspace after agent delivery or a skip. */

"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { requireUser } from "@/lib/dal";
import { AgentChatError, answerAgentPrompt } from "@/lib/server/agent-chat";
import { requireAgentSetup } from "@/lib/server/agent-setup";
import { readProjectSetup, retrySavedProjectSetup, sendProjectSetup, skipSavedProjectSetup, validateProjectLinks, type ProjectFields } from "@/lib/server/project-setup";

export type ProjectSetupFormState = { errors?: Partial<Record<ProjectFields, string>>; message?: string; saved?: boolean };

function goToWorkspace(showProgress = false): never {
  revalidatePath("/dashboard");
  revalidatePath("/onboarding");
  redirect(showProgress ? "/dashboard?setup=1#project-setup-activity" : "/dashboard", "replace");
}

export async function submitProjectSetup(
  _previous: ProjectSetupFormState,
  form: FormData,
): Promise<ProjectSetupFormState> {
  const user = await requireUser();
  requireAgentSetup(user.id);
  const result = validateProjectLinks({ websiteUrl: form.get("websiteUrl"), githubUrl: form.get("githubUrl") });
  if (!result.ok) return { errors: result.errors };
  try {
    const delivery = await sendProjectSetup(user.id, result.setup);
    if (!delivery.ok) {
      revalidatePath("/onboarding");
      return { saved: true, message: "Your links are saved. Check the oma-agent connection and try again." };
    }
  } catch (error) {
    console.error("Project setup failed", error instanceof Error ? error.name : "Unknown error");
    return { message: "Couldn’t finish project setup. Try again." };
  }
  goToWorkspace(true);
}

export async function retryProjectSetup() {
  const user = await requireUser();
  requireAgentSetup(user.id);
  try {
    const result = await retrySavedProjectSetup(user.id);
    revalidatePath("/dashboard");
    revalidatePath("/onboarding");
    return result;
  } catch (error) {
    console.error("Project setup retry failed", error instanceof Error ? error.name : "Unknown error");
    return { error: "Couldn’t retry project setup. Try again." };
  }
}

/** Answers a prompt for the account's current saved setup run. */
export async function answerProjectSetupPrompt(input: unknown) {
  const user = await requireUser();
  requireAgentSetup(user.id);
  const handle = readProjectSetup(user.id)?.delivery?.runHandle;
  if (!handle) return "This project setup run is no longer available.";
  try {
    await answerAgentPrompt(user.id, handle, input);
  } catch (error) {
    if (error instanceof AgentChatError) return error.message;
    console.error("Project setup response failed", error instanceof Error ? error.name : "Unknown error");
    return "Couldn’t send your response to project setup. Try again.";
  }
}

export async function skipProjectSetup() {
  const user = await requireUser();
  requireAgentSetup(user.id);
  skipSavedProjectSetup(user.id);
  goToWorkspace();
}
