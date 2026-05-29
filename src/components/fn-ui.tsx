import { useEffect, useRef } from "react";
import type { ButtonHTMLAttributes, HTMLAttributes, ReactNode } from "react";

type Tone = "default" | "primary" | "success" | "warning" | "danger" | "info" | "muted" | "orange";

function cn(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(" ");
}

export function Card({ className, ...props }: HTMLAttributes<HTMLElement>) {
  return <section className={cn("rounded-[14px] border border-gray-200 bg-white shadow-[0_1px_2px_rgba(17,24,39,0.04)]", className)} {...props} />;
}

export function PageHeader({
  title,
  description,
  actions,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <header className={cn("mb-5 flex flex-wrap items-start justify-between gap-4", className)}>
      <div className="min-w-0">
        <h1 className="text-[28px] font-bold leading-[1.3] text-gray-900">{title}</h1>
        {description && <p className="mt-1.5 text-sm leading-6 text-gray-500">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}

export function SectionHeader({ title, description, actions, className }: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("mb-4 flex flex-wrap items-start justify-between gap-3", className)}>
      <div className="min-w-0">
        <h2 className="text-[18px] font-semibold leading-[1.4] text-gray-900">{title}</h2>
        {description && <p className="mt-1 text-sm text-gray-500">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
  );
}

export function KpiCard({
  label,
  value,
  note,
  tone = "default",
  className,
}: {
  label: ReactNode;
  value: ReactNode;
  note?: ReactNode;
  tone?: Extract<Tone, "default" | "primary" | "success" | "danger" | "orange">;
  className?: string;
}) {
  const valueTone = {
    default: "text-gray-900",
    primary: "text-[#ff6a00]",
    orange: "text-[#ff6a00]",
    success: "text-emerald-600",
    danger: "text-red-600",
  }[tone];

  return (
    <div className={cn("min-w-0 rounded-xl border border-gray-200 bg-white p-4", className)}>
      <p className="truncate text-xs font-semibold text-gray-500">{label}</p>
      <p className={cn("mt-2 break-keep text-xl font-bold leading-tight", valueTone)}>{value}</p>
      {note && <p className="mt-1 truncate text-xs font-medium text-gray-500">{note}</p>}
    </div>
  );
}

export function ActionButton({
  variant = "primary",
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost" | "danger";
}) {
  const variants = {
    primary: "bg-[#ff6a00] text-white hover:bg-[#ea580c]",
    secondary: "border border-gray-300 bg-white text-gray-700 hover:bg-gray-50",
    ghost: "bg-transparent text-gray-600 hover:bg-gray-100",
    danger: "bg-red-600 text-white hover:bg-red-700",
  };

  return (
    <button
      className={cn("inline-flex h-10 items-center justify-center rounded-lg px-4 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-50", variants[variant], className)}
      {...props}
    />
  );
}

export function StatusBadge({ children, tone = "muted", className }: { children: ReactNode; tone?: Tone; className?: string }) {
  const tones = {
    default: "bg-gray-100 text-gray-700",
    muted: "bg-gray-100 text-gray-600",
    primary: "bg-orange-50 text-orange-700",
    orange: "bg-orange-50 text-orange-700",
    success: "bg-emerald-50 text-emerald-700",
    warning: "bg-amber-50 text-amber-700",
    danger: "bg-red-50 text-red-700",
    info: "bg-sky-50 text-sky-700",
  };

  return <span className={cn("inline-flex h-6 items-center rounded-full px-2 text-xs font-medium", tones[tone], className)}>{children}</span>;
}

export function EmptyState({
  title,
  description,
  action,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex min-h-36 flex-col items-center justify-center rounded-xl border border-dashed border-gray-200 bg-gray-50 px-6 py-8 text-center", className)}>
      <div className="mb-3 h-10 w-10 rounded-xl bg-white shadow-sm" />
      <p className="text-sm font-semibold text-gray-900">{title}</p>
      {description && <p className="mt-1 max-w-md text-sm text-gray-500">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function FilterBar({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("flex flex-wrap items-center gap-3 rounded-xl border border-gray-200 bg-white p-4", className)} {...props} />;
}

export function ModalShell({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("rounded-2xl border border-gray-200 bg-white p-6 shadow-xl", className)} {...props} />;
}

export function FormField({ label, children, className }: { label: ReactNode; children: ReactNode; className?: string }) {
  return (
    <label className={cn("block text-xs font-semibold text-gray-500", className)}>
      <span>{label}</span>
      <div className="mt-1">{children}</div>
    </label>
  );
}

const escapeCloseStack: symbol[] = [];

export function useEscapeToClose(enabled: boolean, onClose: () => void) {
  const idRef = useRef<symbol | null>(null);
  if (!idRef.current) idRef.current = Symbol("escape-close");

  useEffect(() => {
    if (!enabled) return;
    const id = idRef.current!;
    escapeCloseStack.push(id);

    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      if (escapeCloseStack[escapeCloseStack.length - 1] !== id) return;
      event.preventDefault();
      event.stopPropagation();
      onClose();
    }

    window.addEventListener("keydown", onKeyDown, true);
    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
      const index = escapeCloseStack.lastIndexOf(id);
      if (index >= 0) escapeCloseStack.splice(index, 1);
    };
  }, [enabled, onClose]);
}
