/**
 * Lightweight UI primitives for the RF Admin console.
 *
 * No shadcn dependency — we keep the admin app's dependency surface minimal.
 * Everything here uses only Tailwind v4 utilities referencing the brand tokens
 * defined in globals.css/@theme inline.
 */

import { type ReactNode } from "react";
import { cn } from "@/lib/utils";

export { cn };

// ── Card ──────────────────────────────────────────────────────────────────────

export function Card({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "rounded-lg border border-[var(--border)] bg-[var(--surface)] p-5",
        className,
      )}
    >
      {children}
    </div>
  );
}

// ── SectionHeader ─────────────────────────────────────────────────────────────

export function SectionHeader({
  eyebrow,
  title,
  description,
  children,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  children?: ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="flex flex-col gap-0.5">
        {eyebrow && (
          <p className="text-[10px] font-mono uppercase tracking-widest text-[var(--text-muted)]">
            {eyebrow}
          </p>
        )}
        <h1 className="text-lg font-semibold text-[var(--text-primary)]">{title}</h1>
        {description && (
          <p className="text-sm text-[var(--text-secondary)]">{description}</p>
        )}
      </div>
      {children && <div className="shrink-0">{children}</div>}
    </div>
  );
}

// ── StatCard ──────────────────────────────────────────────────────────────────

export function StatCard({
  label,
  value,
  sub,
  accent,
}: {
  label: string;
  value: string | number;
  sub?: string;
  accent?: boolean;
}) {
  return (
    <div className="flex flex-col gap-1 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4">
      <span className="text-[10px] font-mono uppercase tracking-widest text-[var(--text-muted)]">
        {label}
      </span>
      <span
        className={cn(
          "text-2xl font-semibold tabular-nums",
          accent ? "text-[var(--accent)]" : "text-[var(--text-primary)]",
        )}
      >
        {value}
      </span>
      {sub && (
        <span className="text-xs text-[var(--text-muted)]">{sub}</span>
      )}
    </div>
  );
}

// ── Badge ─────────────────────────────────────────────────────────────────────

type BadgeTone =
  | "default"
  | "success"
  | "warning"
  | "danger"
  | "info"
  | "muted";

const BADGE_STYLES: Record<BadgeTone, string> = {
  default: "bg-white/[0.06] text-[var(--text-secondary)] border-white/10",
  success: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
  warning: "bg-amber-500/10 text-amber-400 border-amber-500/20",
  danger: "bg-red-500/10 text-[var(--accent)] border-red-500/20",
  info: "bg-blue-500/10 text-blue-400 border-blue-500/20",
  muted: "bg-white/[0.03] text-[var(--text-muted)] border-white/[0.06]",
};

export function Badge({
  children,
  tone = "default",
}: {
  children: ReactNode;
  tone?: BadgeTone;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded border px-1.5 py-0.5 text-[10px] font-mono font-medium uppercase tracking-wider",
        BADGE_STYLES[tone],
      )}
    >
      {children}
    </span>
  );
}

// ── Button ────────────────────────────────────────────────────────────────────

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";

const BUTTON_STYLES: Record<ButtonVariant, string> = {
  primary:
    "bg-[var(--accent)] text-[var(--accent-foreground)] hover:bg-[var(--accent-hover)] border-transparent",
  secondary:
    "border-[var(--border-strong)] bg-[var(--surface-elevated)] text-[var(--text-primary)] hover:border-[var(--accent)]/50",
  ghost:
    "border-transparent text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-white/[0.05]",
  danger:
    "border-red-500/30 bg-red-500/10 text-[var(--accent)] hover:bg-red-500/20",
};

export function Button({
  children,
  variant = "secondary",
  size = "md",
  disabled,
  type = "button",
  className,
  onClick,
}: {
  children: ReactNode;
  variant?: ButtonVariant;
  size?: "sm" | "md";
  disabled?: boolean;
  type?: "button" | "submit" | "reset";
  className?: string;
  onClick?: () => void;
}) {
  return (
    <button
      type={type}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1.5 rounded border font-medium transition-colors",
        "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--accent)]",
        "disabled:pointer-events-none disabled:opacity-40",
        size === "sm"
          ? "px-2.5 py-1 text-xs"
          : "px-3.5 py-1.5 text-sm",
        BUTTON_STYLES[variant],
        className,
      )}
    >
      {children}
    </button>
  );
}

// ── DataTable ─────────────────────────────────────────────────────────────────

export function Table({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("w-full overflow-x-auto rounded-lg border border-[var(--border)]", className)}>
      <table className="w-full text-sm">{children}</table>
    </div>
  );
}

export function Thead({ children }: { children: ReactNode }) {
  return (
    <thead className="border-b border-[var(--border)] bg-white/[0.02] text-[10px] font-mono uppercase tracking-widest text-[var(--text-muted)]">
      {children}
    </thead>
  );
}

export function Th({
  children,
  className,
}: {
  children?: ReactNode;
  className?: string;
}) {
  return (
    <th className={cn("px-4 py-2.5 text-left font-medium", className)}>
      {children}
    </th>
  );
}

export function Tbody({ children }: { children: ReactNode }) {
  return (
    <tbody className="divide-y divide-[var(--border)]">{children}</tbody>
  );
}

export function Tr({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <tr
      className={cn(
        "bg-[var(--surface)] transition-colors hover:bg-white/[0.025]",
        className,
      )}
    >
      {children}
    </tr>
  );
}

export function Td({
  children,
  className,
  mono,
}: {
  children?: ReactNode;
  className?: string;
  mono?: boolean;
}) {
  return (
    <td
      className={cn(
        "px-4 py-3 text-[var(--text-secondary)]",
        mono && "font-mono text-xs",
        className,
      )}
    >
      {children}
    </td>
  );
}

// ── Empty state ───────────────────────────────────────────────────────────────

export function Empty({ message }: { message: string }) {
  return (
    <div className="flex h-32 items-center justify-center text-sm text-[var(--text-muted)]">
      {message}
    </div>
  );
}

// ── Spinner ───────────────────────────────────────────────────────────────────

export function Spinner({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      className={cn("animate-spin text-[var(--text-muted)]", className)}
      fill="none"
      viewBox="0 0 24 24"
    >
      <circle
        className="opacity-25"
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth="4"
      />
      <path
        className="opacity-75"
        d="M4 12a8 8 0 018-8v4l3-3-3-3V4a10 10 0 100 20 10 10 0 010-20z"
        fill="currentColor"
      />
    </svg>
  );
}

// ── FormField ─────────────────────────────────────────────────────────────────

export function FormField({
  label,
  htmlFor,
  hint,
  children,
}: {
  label: string;
  htmlFor?: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label
        htmlFor={htmlFor}
        className="text-xs font-medium text-[var(--text-secondary)]"
      >
        {label}
      </label>
      {children}
      {hint && (
        <p className="text-[11px] text-[var(--text-muted)]">{hint}</p>
      )}
    </div>
  );
}

export function Input({
  id,
  type = "text",
  value,
  defaultValue,
  name,
  min,
  max,
  step,
  placeholder,
  disabled,
  className,
  onChange,
}: {
  id?: string;
  type?: string;
  value?: string | number;
  defaultValue?: string | number;
  name?: string;
  min?: string | number;
  max?: string | number;
  step?: string | number;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  onChange?: (e: React.ChangeEvent<HTMLInputElement>) => void;
}) {
  return (
    <input
      id={id}
      type={type}
      name={name}
      value={value}
      defaultValue={defaultValue}
      min={min}
      max={max}
      step={step}
      placeholder={placeholder}
      disabled={disabled}
      onChange={onChange}
      className={cn(
        "rounded border border-[var(--border)] bg-[var(--surface-elevated)]",
        "px-3 py-1.5 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)]",
        "focus:outline-none focus:ring-1 focus:ring-[var(--accent)] focus:border-[var(--accent)]/60",
        "disabled:opacity-40",
        className,
      )}
    />
  );
}

export function Textarea({
  id,
  name,
  defaultValue,
  rows = 4,
  placeholder,
  disabled,
  className,
}: {
  id?: string;
  name?: string;
  defaultValue?: string;
  rows?: number;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <textarea
      id={id}
      name={name}
      defaultValue={defaultValue}
      rows={rows}
      placeholder={placeholder}
      disabled={disabled}
      className={cn(
        "rounded border border-[var(--border)] bg-[var(--surface-elevated)]",
        "px-3 py-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)]",
        "focus:outline-none focus:ring-1 focus:ring-[var(--accent)] focus:border-[var(--accent)]/60",
        "disabled:opacity-40 resize-y",
        className,
      )}
    />
  );
}

export function Select({
  id,
  name,
  defaultValue,
  value,
  disabled,
  children,
  className,
  onChange,
}: {
  id?: string;
  name?: string;
  defaultValue?: string;
  value?: string;
  disabled?: boolean;
  children: ReactNode;
  className?: string;
  onChange?: (e: React.ChangeEvent<HTMLSelectElement>) => void;
}) {
  return (
    <select
      id={id}
      name={name}
      defaultValue={defaultValue}
      value={value}
      disabled={disabled}
      onChange={onChange}
      className={cn(
        "rounded border border-[var(--border)] bg-[var(--surface-elevated)]",
        "px-3 py-1.5 text-sm text-[var(--text-primary)]",
        "focus:outline-none focus:ring-1 focus:ring-[var(--accent)] focus:border-[var(--accent)]/60",
        "disabled:opacity-40",
        className,
      )}
    >
      {children}
    </select>
  );
}

// ── Divider ───────────────────────────────────────────────────────────────────

export function Divider({ className }: { className?: string }) {
  return <hr className={cn("border-[var(--border)]", className)} />;
}

// ── KeyValue pair for detail views ────────────────────────────────────────────

export function KV({
  label,
  value,
  mono,
}: {
  label: string;
  value?: string | number | null;
  mono?: boolean;
}) {
  return (
    <>
      <dt className="bg-[var(--surface)] px-4 py-2.5 text-xs text-[var(--text-muted)]">
        {label}
      </dt>
      <dd
        className={cn(
          "bg-[var(--surface)] px-4 py-2.5 text-sm text-[var(--text-primary)]",
          mono && "font-mono text-xs",
        )}
      >
        {value ?? <span className="text-[var(--text-muted)]">—</span>}
      </dd>
    </>
  );
}
