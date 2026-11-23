/** Authenticates project setup submissions and opens the workspace after agent delivery or a skip. */

"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { requireUser } from "@/lib/dal";
import { requireAgentSetup } from "@/lib/server/agent-setup";
import { sendProjectSetup, skipSavedProjectSetup, validateProjectLinks, type ProjectFields } from "@/lib/server/project-setup";

export type ProjectSetupFormState = { errors?: Partial<Record<ProjectFields, string>>; message?: string; saved?: boolean };

function goToWorkspace(): never {
  revalidatePath("/dashboard");
  revalidatePath("/onboarding");
  redirect("/dashboard", "replace");
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
  goToWorkspace();
}

export async function skipProjectSetup() {
  const user = await requireUser();
  requireAgentSetup(user.id);
  skipSavedProjectSetup(user.id);
  goToWorkspace();
}
