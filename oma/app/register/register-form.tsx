"use client";
import { useActionState, useState } from "react";
import { ArrowRight, CircleAlert, LoaderCircle } from "lucide-react";
import { registerAction, type AuthFormState } from "@/app/actions/auth";
import { PasswordField } from "@/components/password-field";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
export function RegisterForm() {
  const [email, setEmail] = useState("");
  const [state, action, pending] = useActionState<AuthFormState, FormData>(
    registerAction,
    undefined,
  );

  return (
    <form action={action} className="auth-form" aria-busy={pending}>
      <div className="auth-field">
        <label htmlFor="email">Email address</label>
        <Input
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
      <PasswordField register />
      <PasswordField register confirm />
      {state?.error && (
        <Alert variant="destructive">
          <CircleAlert aria-hidden="true" />
          <AlertDescription>{state.error}</AlertDescription>
        </Alert>
      )}
      <Button className="auth-submit" disabled={pending}>
        {pending ? (
          <>
            <LoaderCircle size={17} className="spin" aria-hidden="true" />
            Creating your account…
          </>
        ) : (
          <>
            Create account
            <ArrowRight size={17} aria-hidden="true" />
          </>
        )}
      </Button>
    </form>
  );
}
