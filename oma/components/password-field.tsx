"use client";
import { useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
export function PasswordField({
  confirm = false,
  register = false,
}: {
  confirm?: boolean;
  register?: boolean;
}) {
  const [visible, setVisible] = useState(false);
  const [value, setValue] = useState("");
  const name = confirm ? "confirmPassword" : "password";
  const visibilityTarget = confirm ? "password confirmation" : "password";
  const hintId = register && !confirm ? "password-requirements" : undefined;
  return (
    <div className="auth-field">
      <label htmlFor={name}>{confirm ? "Confirm password" : "Password"}</label>
      <div className="password-input">
        <Input
          id={name}
          name={name}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          type={visible ? "text" : "password"}
          autoComplete={register ? "new-password" : "current-password"}
          aria-describedby={hintId}
          required
          minLength={register ? 8 : undefined}
          maxLength={128}
          placeholder={
            confirm
              ? "Enter your password again"
              : register
                ? "Create a strong password"
                : "Enter your password"
          }
        />
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={`${visible ? "Hide" : "Show"} ${visibilityTarget}`}
          aria-controls={name}
          onClick={() => setVisible(!visible)}
        >
          {visible ? <EyeOff size={17} aria-hidden="true" /> : <Eye size={17} aria-hidden="true" />}
        </Button>
      </div>
      {hintId && (
        <span id={hintId} className="field-hint">Use 8–128 characters.</span>
      )}
    </div>
  );
}
