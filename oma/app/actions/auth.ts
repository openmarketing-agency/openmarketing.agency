"use server";

import { redirect } from "next/navigation";

import * as api from "@/lib/backend";
import { clearToken, getAccessToken, setToken } from "@/lib/session";

/**
 * Authentication Server Actions.
 *
 * Registration and sign-in issue a long-lived HTTP-only session cookie.
 */

export type AuthFormState = { error: string } | undefined;

export async function loginAction(
  _prevState: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");

  if (!email || !password) {
    return { error: "Enter both your email and password." };
  }

  const result = await api.login(email, password);
  if (!result.ok) {
    return { error: result.error.message };
  }

  await setToken(result.data);
  redirect(process.env.OMA_WORKSPACE_SOCKET ? "/agent-setup" : "/dashboard");
}

export async function registerAction(
  _prevState: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const confirmPassword = String(formData.get("confirmPassword") ?? "");

  if (!email || !password) {
    return { error: "Enter both your email and password." };
  }
  if (password.length < 8 || password.length > 128) {
    return { error: "Choose a password between 8 and 128 characters." };
  }
  if (password !== confirmPassword) {
    return { error: "The passwords do not match." };
  }

  const created = await api.register(email, password);
  if (!created.ok) {
    return { error: created.error.message };
  }

  const signedIn = await api.login(created.data.email, password);
  if (!signedIn.ok) redirect("/login");
  await setToken(signedIn.data);
  redirect("/onboarding");
}

/** Ends the account's sessions on the server, so a copied token stops working, then clears the cookie. */
export async function logoutAction(): Promise<void> {
  const accessToken = await getAccessToken();
  // Best effort: an expired or already-revoked token still ends the local session.
  if (accessToken) await api.logoutAll(accessToken);

  await clearToken();
  redirect("/login");
}
