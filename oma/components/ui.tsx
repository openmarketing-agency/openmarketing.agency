import type { ReactNode } from "react";

/** Shared presentation primitives, thin enough to stay out of the way. */

export const buttonPrimary =
  "inline-flex items-center justify-center rounded-md bg-[var(--accent)] px-4 py-2 text-sm font-medium text-background! transition hover:bg-[var(--accent-hover)] disabled:cursor-not-allowed disabled:opacity-60";

export const buttonSecondary =
  "inline-flex items-center justify-center rounded-md border border-[var(--control)] bg-background px-4 py-2 text-sm font-medium transition hover:bg-[var(--raised)] disabled:cursor-not-allowed disabled:opacity-60";

export const buttonDanger =
  "inline-flex items-center justify-center rounded-md border border-[var(--negative-border)] px-4 py-2 text-sm font-medium text-[color:var(--negative)]! transition hover:bg-[var(--negative-soft)] disabled:cursor-not-allowed disabled:opacity-60";

export const buttonCompact =
  "inline-flex items-center justify-center rounded-md border border-[var(--control)] bg-background px-3 py-1.5 text-xs font-medium transition hover:bg-[var(--raised)] disabled:cursor-not-allowed disabled:opacity-60";

export const buttonDangerCompact =
  "inline-flex items-center justify-center rounded-md border border-[var(--negative-border)] px-3 py-1.5 text-xs font-medium text-[color:var(--negative)]! transition hover:bg-[var(--negative-soft)] disabled:cursor-not-allowed disabled:opacity-60";

export function Badge({
  children,
  tone = "neutral",
}: {
  children: string;
  tone?: "neutral" | "good" | "muted";
}) {
  const tones = {
    neutral: "border-[var(--border)] text-foreground",
    good: "border-[var(--border)] bg-[var(--positive-soft)] text-[color:var(--positive)]",
    muted: "border-[var(--border)] text-[color:var(--muted)]",
  };
  return (
    <span className={`rounded-full border px-2 py-0.5 text-xs ${tones[tone]}`}>
      {children}
    </span>
  );
}

export const inputClass =
  "mt-1 w-full rounded-md border border-[var(--control)] bg-background px-3 py-2 text-sm transition focus:border-[var(--accent)] disabled:opacity-60";

export function Card({
  title,
  subtitle,
  children,
}: {
  title?: string;
  subtitle?: string;
  children: ReactNode;
}) {
  return (
    <section className="rounded-xl border border-[var(--border)] bg-[var(--raised)] p-6">
      {title ? (
        <h2 className="text-sm font-medium text-[var(--muted)]">{title}</h2>
      ) : null}
      {subtitle ? <p className="mt-2 text-sm opacity-70">{subtitle}</p> : null}
      <div className={title || subtitle ? "mt-4" : undefined}>{children}</div>
    </section>
  );
}

export function Field({
  label,
  name,
  type = "text",
  autoComplete,
  hint,
  required,
}: {
  label: string;
  name: string;
  type?: string;
  autoComplete?: string;
  hint?: string;
  required?: boolean;
}) {
  return (
    <div>
      <label htmlFor={name} className="block text-sm font-medium">
        {label}
      </label>
      <input
        id={name}
        name={name}
        type={type}
        autoComplete={autoComplete}
        required={required}
        className={inputClass}
      />
      {hint ? <p className="mt-1 text-xs opacity-60">{hint}</p> : null}
    </div>
  );
}

export function Alert({ children }: { children: ReactNode }) {
  return (
    <p
      role="alert"
      className="rounded-md border border-[var(--negative-border)] bg-[var(--negative-soft)] px-3 py-2 text-sm text-[color:var(--negative)]!"
    >
      {children}
    </p>
  );
}

/** Shown while a request-time section streams in. */
export function Loading({ label }: { label: string }) {
  return (
    <div className="page-content console-loading" role="status">
      <span className="sr-only">{label}</span>
      <span className="loading-title" aria-hidden="true" />
      <span className="loading-line" aria-hidden="true" />
      <div className="loading-panel" aria-hidden="true"><span className="loading-line" /><span className="loading-line" /></div>
    </div>
  );
}

export function Row({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-[var(--border)] py-2 last:border-0">
      <dt className="text-sm opacity-60">{label}</dt>
      <dd className="text-sm font-medium">{value}</dd>
    </div>
  );
}
