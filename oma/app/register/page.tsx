import type { Metadata } from "next";
import { connection } from "next/server";
import { Suspense } from "react";

import { AuthLayout } from "@/components/auth-layout";
import { getDb } from "@/lib/db";
import { loadSettings } from "@/lib/server/settings";
import { RegisterForm } from "./register-form";

export const metadata: Metadata = { title: "Create account" };

async function Registration() {
  await connection();
  if (!loadSettings().registrationEnabled || getDb().prepare("SELECT 1 FROM users WHERE slot = 1").get()) {
    return <p className="settings-note" role="status">Registration is closed. Sign in with your existing account.</p>;
  }
  return <RegisterForm />;
}

export default function Page() {
  return (
    <AuthLayout register>
      <Suspense fallback={<p role="status">Checking registration…</p>}>
        <Registration />
      </Suspense>
    </AuthLayout>
  );
}
