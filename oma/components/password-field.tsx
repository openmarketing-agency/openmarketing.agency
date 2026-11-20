"use client";
import { useState } from "react";
import { Eye, EyeOff } from "lucide-react";
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
  return (
    <div className="auth-field">
      <label htmlFor={name}>{confirm ? "Confirm password" : "Password"}</label>
      <div className="password-input">
        <input
          id={name}
          name={name}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          type={visible ? "text" : "password"}
          autoComplete={register ? "new-password" : "current-password"}
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
        <button
          type="button"
          aria-label={visible ? "Hide password" : "Show password"}
          onClick={() => setVisible(!visible)}
        >
          {visible ? <EyeOff size={17} /> : <Eye size={17} />}
        </button>
      </div>
      {register && !confirm && (
        <span className="field-hint">Use 8–128 characters.</span>
      )}
    </div>
  );
}
