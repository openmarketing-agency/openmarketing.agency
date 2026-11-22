/** Keeps entry screens focused on one action and the link to switch between signing in and registering. */

import Link from "next/link";
import type { ReactNode } from "react";

import { Brand } from "@/components/brand";

export function AuthLayout({ register = false, children }: { register?: boolean; children: ReactNode }) {
  return (
    <main className="workspace-entry" id="main-content">
      <header className="workspace-entry-bar"><Brand href="/login" /></header>
      <section className="workspace-entry-panel" aria-labelledby="auth-heading">
        <header>
          <h1 id="auth-heading">{register ? "Create your workspace" : "Sign in"}</h1>
          {register && <p>Create the account for this OMA installation.</p>}
        </header>
        {children}
        <p className="workspace-entry-switch">
          {register ? "Already have an account?" : "New to OMA?"}
          <Link href={register ? "/login" : "/register"}>{register ? "Sign in" : "Create an account"}</Link>
        </p>
      </section>
    </main>
  );
}
