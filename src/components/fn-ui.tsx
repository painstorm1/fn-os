import { useEffect, useRef } from "react";
import type { ButtonHTMLAttributes, HTMLAttributes, ReactNode } from "react";

type Tone = "default" | "primary" | "success" | "warning" | "danger" | "info" | "muted" | "orange";

function cn(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(" ");
}

function visualDescription(value?: ReactNode) {
  return typeof value === "string" ? null : value;
}

let f4SaveShortcutReady = false;
let f4SaveObserver: MutationObserver | null = null;

function isF4SaveLabel(value: string) {
  const text = value.replace(/\s+/g, " ").trim();
  if (!text || text === "F4 저장" || /저장\s*중/.test(text)) return false;
  return text === "저장" || text.endsWith(" 저장");
}

function isVisibleElement(element: HTMLElement) {
  const style = window.getComputedStyle(element);
  return style.display !== "none" && style.visibility !== "hidden" && style.opacity !== "0" && element.getClientRects().length > 0;
}

function isSaveButton(element: Element): element is HTMLButtonElement | HTMLInputElement {
  if (!(element instanceof HTMLButtonElement || element instanceof HTMLInputElement)) return false;
  if (element.dataset.f4Save === "false") return false;
  if (element.disabled) return false;
  if (element instanceof HTMLInputElement && !["button", "submit"].includes(element.type)) return false;
  const label = element instanceof HTMLInputElement ? element.value : element.textContent || "";
  return element.dataset.f4Save === "true" || isF4SaveLabel(label) || label.trim() === "F4 저장";
}

function decorateF4SaveButtons(root: ParentNode = document) {
  root.querySelectorAll("button, input[type='button'], input[type='submit']").forEach((element) => {
    if (!isSaveButton(element)) return;
    const label = element instanceof HTMLInputElement ? element.value : element.textContent || "";
    if (!isF4SaveLabel(label)) return;
    element.dataset.f4Save = "true";
    element.title ||= "F4 저장";
    if (element instanceof HTMLInputElement) element.value = "F4 저장";
    else element.textContent = "F4 저장";
  });
}

function visibleSaveButtons(root: ParentNode = document) {
  return Array.from(root.querySelectorAll("button, input[type='button'], input[type='submit']"))
    .filter(isSaveButton)
    .filter((element) => isVisibleElement(element));
}

function findF4SaveButton() {
  decorateF4SaveButtons();
  const active = document.activeElement;
  if (active instanceof HTMLElement) {
    const activeForm = active.closest("form");
    const formButton = activeForm ? visibleSaveButtons(activeForm)[0] : null;
    if (formButton) return formButton;
  }
  const modal = Array.from(document.querySelectorAll("[role='dialog'], .fixed, .modal"))
    .filter((element): element is HTMLElement => element instanceof HTMLElement && isVisibleElement(element))
    .pop();
  const modalButton = modal ? visibleSaveButtons(modal).pop() : null;
  if (modalButton) return modalButton;
  return visibleSaveButtons().pop() || null;
}

function ensureF4SaveShortcut() {
  if (typeof window === "undefined" || f4SaveShortcutReady) return;
  f4SaveShortcutReady = true;
  window.setTimeout(() => decorateF4SaveButtons(), 0);
  f4SaveObserver = new MutationObserver(() => decorateF4SaveButtons());
  f4SaveObserver.observe(document.body, { childList: true, subtree: true, characterData: true });
  window.addEventListener("keydown", (event) => {
    if (event.key !== "F4" || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    const button = findF4SaveButton();
    if (!button) return;
    event.preventDefault();
    event.stopPropagation();
    button.click();
  }, true);
}

export function useF4SaveShortcut() {
  useEffect(() => ensureF4SaveShortcut(), []);
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
  const visual = visualDescription(description);
  return (
    <header className={cn("mb-5 flex flex-wrap items-start justify-between gap-4", className)}>
      <div className="min-w-0">
        <h1 className="text-[28px] font-bold leading-[1.3] text-gray-900">{title}</h1>
        {visual && <div className="mt-1.5 text-sm leading-6 text-gray-500">{visual}</div>}
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
  const visual = visualDescription(description);
  return (
    <div className={cn("mb-4 flex flex-wrap items-start justify-between gap-3", className)}>
      <div className="min-w-0">
        <h2 className="text-[18px] font-semibold leading-[1.4] text-gray-900">{title}</h2>
        {visual && <div className="mt-1 text-sm text-gray-500">{visual}</div>}
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
  children,
  title,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost" | "danger";
}) {
  useF4SaveShortcut();
  const variants = {
    primary: "bg-[#ff6a00] text-white hover:bg-[#ea580c]",
    secondary: "border border-gray-300 bg-white text-gray-700 hover:bg-gray-50",
    ghost: "bg-transparent text-gray-600 hover:bg-gray-100",
    danger: "bg-red-600 text-white hover:bg-red-700",
  };
  const explicitF4Save = (props as Record<string, unknown>)["data-f4-save"];
  const saveLabel = explicitF4Save !== "false" && typeof children === "string" && isF4SaveLabel(children);

  return (
    <button
      {...props}
      data-f4-save={explicitF4Save ?? (saveLabel ? "true" : undefined)}
      title={saveLabel ? title || "F4 저장" : title}
      className={cn("inline-flex h-10 items-center justify-center rounded-lg px-4 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-50", variants[variant], className)}
    >
      {saveLabel ? "F4 저장" : children}
    </button>
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
      {description && <div className="mt-1 max-w-md text-sm text-gray-500">{description}</div>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function FilterBar({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("flex flex-wrap items-center gap-3 rounded-xl border border-gray-200 bg-white p-4", className)} {...props} />;
}

type ModalSize = "sm" | "md" | "lg" | "xl" | "full";

const modalSizes: Record<ModalSize, string> = {
  sm: "max-w-[420px]",
  md: "max-w-[560px]",
  lg: "max-w-[760px]",
  xl: "max-w-[960px]",
  full: "max-w-[1120px]",
};

export const modalInputClass =
  "h-10 w-full rounded-lg border border-gray-300 bg-white px-3 text-sm font-medium text-gray-900 outline-none placeholder:text-gray-400 focus:border-[#ff6a00] focus:ring-2 focus:ring-orange-100";
export const modalSelectClass =
  "h-10 w-full rounded-lg border border-gray-300 bg-white px-3 text-sm font-medium text-gray-900 outline-none focus:border-[#ff6a00] focus:ring-2 focus:ring-orange-100";
export const modalTextareaClass =
  "min-h-24 w-full rounded-lg border border-gray-300 bg-white px-3 py-3 text-sm font-medium text-gray-900 outline-none placeholder:text-gray-400 focus:border-[#ff6a00] focus:ring-2 focus:ring-orange-100";

export function ModalShell({
  className,
  size = "lg",
  ...props
}: HTMLAttributes<HTMLDivElement> & {
  size?: ModalSize;
}) {
  return <div className={cn("relative w-full rounded-2xl border border-gray-200 bg-white p-6 shadow-xl", modalSizes[size], className)} {...props} />;
}

export function ModalCloseButton({ className, ...props }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      aria-label="닫기"
      className={cn("inline-flex h-8 w-8 items-center justify-center rounded-lg text-xl leading-none text-gray-500 transition hover:bg-gray-100 hover:text-gray-700", className)}
      {...props}
    >
      ×
    </button>
  );
}

export function ModalHeader({
  title,
  description,
  onClose,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  onClose?: () => void;
  className?: string;
}) {
  return (
    <div className={cn("flex items-start justify-between gap-4 border-b border-gray-200 pb-4", className)}>
      <div className="min-w-0">
        <h3 className="text-xl font-bold leading-tight text-gray-900">{title}</h3>
        {description && <div className="mt-1 text-[13px] font-medium leading-5 text-gray-500">{description}</div>}
      </div>
      {onClose && <ModalCloseButton onClick={onClose} />}
    </div>
  );
}

export function ModalBody({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("py-5", className)} {...props} />;
}

export function ModalFooter({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("flex justify-end gap-2 border-t border-gray-200 pt-4", className)} {...props} />;
}

function ModalOverlay({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-gray-900/55 px-4 py-8", className)}>{children}</div>;
}

export function FormModal({
  title,
  description,
  onClose,
  children,
  footer,
  size = "lg",
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  size?: ModalSize;
  className?: string;
}) {
  useEscapeToClose(true, onClose);

  return (
    <ModalOverlay>
      <ModalShell size={size} className={className}>
        <ModalHeader title={title} description={description} onClose={onClose} />
        <ModalBody>{children}</ModalBody>
        {footer && <ModalFooter>{footer}</ModalFooter>}
      </ModalShell>
    </ModalOverlay>
  );
}

export function SelectionModal({
  title,
  description,
  onClose,
  children,
  footer,
  size = "xl",
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  size?: ModalSize;
  className?: string;
}) {
  useEscapeToClose(true, onClose);

  return (
    <ModalOverlay className="py-10">
      <ModalShell size={size} className={className}>
        <ModalHeader title={title} description={description} onClose={onClose} />
        <ModalBody>{children}</ModalBody>
        {footer && <ModalFooter>{footer}</ModalFooter>}
      </ModalShell>
    </ModalOverlay>
  );
}

export function ConfirmModal({
  title,
  description,
  onClose,
  onConfirm,
  confirmLabel = "확인",
  cancelLabel = "취소",
  danger = false,
}: {
  title: ReactNode;
  description?: ReactNode;
  onClose: () => void;
  onConfirm: () => void;
  confirmLabel?: ReactNode;
  cancelLabel?: ReactNode;
  danger?: boolean;
}) {
  return (
    <FormModal
      title={title}
      description={description}
      onClose={onClose}
      size="sm"
      footer={
        <>
          <ActionButton type="button" variant="secondary" onClick={onClose}>{cancelLabel}</ActionButton>
          <ActionButton type="button" variant={danger ? "danger" : "primary"} onClick={onConfirm}>{confirmLabel}</ActionButton>
        </>
      }
    >
      <div />
    </FormModal>
  );
}

export function FormField({ label, children, className, required = false }: { label: ReactNode; children: ReactNode; className?: string; required?: boolean }) {
  return (
    <label className={cn("block text-[13px] font-semibold text-gray-700", className)}>
      <span>{label}{required && <span className="ml-1 text-[#ff6a00]">*</span>}</span>
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
