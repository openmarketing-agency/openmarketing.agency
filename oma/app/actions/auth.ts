"use server";

import { redirect } from "next/navigation";

import * as api from "@/lib/backend";
import { hermesConfigured } from "@/lib/server/marketing/hermes";
import {
  clearTokens,
  getAccessToken,
  getRefreshToken,
  setTokens,
} from "@/lib/session";

/**
 * Authentication Server Actions.
 *
 * Registration and sign-in issue HTTP-only session cookies.
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

  await setTokens(result.data);
  redirect("/dashboard");
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
  await setTokens(signedIn.data);
  redirect(hermesConfigured() ? "/onboarding" : "/dashboard");
}

/** Revokes the current refresh token, then clears the local session. */
export async function logoutAction(): Promise<void> {
  const refreshToken = await getRefreshToken();
  if (refreshToken) {
    // Best effort: a revoked or already-expired token still ends the local session.
    await api.logout(refreshToken);
  }

  await clearTokens();
  redirect("/login");
}

/** Revokes every refresh token for the account, ending all sessions. */
export async function logoutEverywhereAction(): Promise<void> {
  const accessToken = await getAccessToken();
  if (accessToken) {
    await api.logoutAll(accessToken);
  }

  await clearTokens();
  redirect("/login");
}
