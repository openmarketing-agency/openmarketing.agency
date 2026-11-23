"use client";
import { useActionState, useState } from "react";
import { ArrowRight, LoaderCircle } from "lucide-react";
import { loginAction, type AuthFormState } from "@/app/actions/auth";
import { PasswordField } from "@/components/password-field";
export function LoginForm() {
  const [email, setEmail] = useState("");
  const [state, action, pending] = useActionState<AuthFormState, FormData>(
    loginAction,
    undefined,
  );
  return (
    <form action={action} className="auth-form" aria-busy={pending}>
      <div className="auth-field">
        <label htmlFor="email">Email address</label>
        <input
          id="email"
          name="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          type="email"
          autoComplete="email"
          placeholder="you@company.com"
          required
        />
      </div>
      <PasswordField />
      {state?.error && (
        <p role="alert" className="form-error">
          {state.error}
        </p>
      )}
      <button className="btn primary auth-submit" disabled={pending}>
        {pending ? (
          <>
            <LoaderCircle size={17} className="spin" aria-hidden="true" />
            Signing in…
          </>
        ) : (
          <>
            Sign in
            <ArrowRight size={17} aria-hidden="true" />
          </>
        )}
      </button>
    </form>
  );
}
