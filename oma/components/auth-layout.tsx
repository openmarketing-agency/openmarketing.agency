/** Pairs account access with a preview of the campaign workflow. */

import { ArrowRight, Bot, ClipboardCheck, Megaphone } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

import { Brand } from "@/components/brand";
import "./auth-layout.css";

const workflow = [
  { label: "Plan campaigns", detail: "Organize goals, tasks, and tools.", icon: Megaphone },
  { label: "Work with agents", detail: "Follow progress and give guidance.", icon: Bot },
  { label: "Review approvals", detail: "Check publications before they go live.", icon: ClipboardCheck },
];

export function AuthLayout({ register = false, children }: { register?: boolean; children: ReactNode }) {
  return (
    <div className="account-entry">
      <main className="account-entry-main" id="main-content" tabIndex={-1}>
        <header><Brand href="/" /></header>
        <div className="entry-form-panel account-form-panel">
          <h1 id="auth-heading">{register ? "Create your account" : "Sign in"}</h1>
          <p>{register ? "Set up the account for this OMA installation." : "Open your workspace to manage campaigns, tools, and approvals."}</p>
          {children}
          <p className="workspace-entry-switch">
            {register ? "Already have an account?" : "New to OMA?"}
            <Link href={register ? "/login" : "/register"}>
              {register ? "Sign in" : "Create an account"} <ArrowRight size={15} aria-hidden="true" />
            </Link>
          </p>
        </div>
        <footer>Open Marketing Agency</footer>
      </main>
      <section className="account-workflow" aria-labelledby="account-workflow-title">
        <div className="account-workflow-content">
          <h2 id="account-workflow-title">One workspace for your marketing campaigns.</h2>
          <p>Plan the work, collaborate with your agents, and review what’s ready to publish.</p>
          <ol aria-label="Campaign workflow">
            {workflow.map(({ label, detail, icon: Icon }) => (
              <li key={label}>
                <span className="account-workflow-icon"><Icon size={20} aria-hidden="true" /></span>
                <div><strong>{label}</strong><p>{detail}</p></div>
              </li>
            ))}
          </ol>
        </div>
      </section>
    </div>
  );
}
