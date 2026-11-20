import Link from "next/link";
import Image from "next/image";
import { ArrowDown, ArrowRight, Cable, Check, Terminal } from "lucide-react";
import type { ReactNode } from "react";
import { Brand } from "@/components/brand";
export function AuthLayout({
  register = false,
  children,
}: {
  register?: boolean;
  children: ReactNode;
}) {
  return (
    <main className="auth-layout" id="main-content">
      <section className="auth-main">
        <Brand href="/login" />
        <div className="auth-form-area">
          <div className="eyebrow">Your next good idea starts here</div>
          <h1>{register ? "Create your workspace" : "Welcome back"}</h1>
          <p>
            {register
              ? "Connect your tools. Give your AI a running start."
              : "Sign in to your tools, playbooks, and possibilities."}
          </p>
          {children}
          <p className="auth-switch">
            {register ? "Already have an account?" : "New to OMA?"}{" "}
            <Link href={register ? "/login" : "/register"}>
              {register ? "Sign in" : "Create an account"}
              <ArrowRight size={14} />
            </Link>
          </p>
        </div>
        <footer className="auth-footer">
          OMA<span>Built for work that moves you forward.</span>
        </footer>
      </section>
      <section className="auth-story" aria-label="About OMA">
        <div className="story-topline">
          <span>Less setup. More possibility.</span>
          <Image className="story-mascot" src="/orca-mascot.webp" alt="" width={480} height={480} unoptimized />
        </div>
        <div className="story-content">
          <h2>
            Your tools.
            <br />
            Working together.
          </h2>
          <p>
            Bring your marketing data, a proven playbook, and your favorite AI
            into the same conversation.
          </p>
          <div className="connection-blueprint">
            <div className="blueprint-tools">
              <span>Search Console</span>
              <span>Analytics</span>
              <span>+ your tools</span>
            </div>
            <ArrowDown className="blueprint-arrow" size={22} />
            <div className="blueprint-center">
              <Brand href="/login" />
              <span>Tools + playbooks + your context</span>
            </div>
            <ArrowDown className="blueprint-arrow" size={22} />
            <div className="blueprint-output">
              <Terminal size={19} />
              <span>One MCP URL. Your AI workspace.</span>
              <Check size={17} />
            </div>
          </div>
          <ul className="story-benefits">
            <li>
              <Cable size={16} />
              Connect your tools securely
            </li>
            <li>
              <Check size={16} />
              Use the AI assistant you already love
            </li>
          </ul>
        </div>
        <span className="story-footer">
          A clearer path from insight to action.
        </span>
      </section>
    </main>
  );
}
