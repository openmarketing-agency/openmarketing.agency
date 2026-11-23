/** Presents one account action at a time for a self-hosted OMA installation. */

import { ArrowRight } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

import { Brand } from "@/components/brand";
import "./auth-layout.css";

export function AuthLayout({ register = false, children }: { register?: boolean; children: ReactNode }) {
  return (
    <div className="workspace-entry">
      <header className="workspace-entry-bar"><Brand href="/" /></header>
      <main className="entry-form-panel" id="main-content" tabIndex={-1}>
        <h1 id="auth-heading">{register ? "Create your account" : "Sign in"}</h1>
        <p>{register ? "Set up the account for this OMA installation." : "Open your workspace to manage campaigns, tools, and approvals."}</p>
        {children}
        <p className="workspace-entry-switch">
          {register ? "Already have an account?" : "New to OMA?"}
          <Link href={register ? "/login" : "/register"}>
            {register ? "Sign in" : "Create an account"} <ArrowRight size={15} aria-hidden="true" />
          </Link>
        </p>
      </main>
    </div>
  );
}
