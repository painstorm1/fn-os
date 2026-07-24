import { forwardRef, useEffect, useId, useImperativeHandle, useRef, useState } from "react";
import type { ButtonHTMLAttributes, HTMLAttributes, InputHTMLAttributes, KeyboardEvent as ReactKeyboardEvent, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from "react";
import { formatCalendarInputValue, normalizeCalendarInput, type CalendarInputMode } from "@/lib/calendar-input";

type Tone = "default" | "primary" | "success" | "warning" | "danger" | "info" | "muted" | "orange";

function cn(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(" ");
}

function visualDescription(value?: ReactNode) {
  return value;
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

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input({ className, ...props }, ref) {
  return <input ref={ref} className={cn(modalInputClass, className)} {...props} />;
});
Input.displayName = "Input";

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(function Select({ className, ...props }, ref) {
  return <select ref={ref} className={cn(modalSelectClass, className)} {...props} />;
});
Select.displayName = "Select";

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea({ className, ...props }, ref) {
  return <textarea ref={ref} className={cn(modalTextareaClass, className)} {...props} />;
});
Textarea.displayName = "Textarea";

export const Checkbox = forwardRef<HTMLInputElement, Omit<InputHTMLAttributes<HTMLInputElement>, "type">>(function Checkbox({ className, ...props }, ref) {
  return <input ref={ref} type="checkbox" className={cn("h-4 w-4 accent-[#ff6a00]", className)} {...props} />;
});
Checkbox.displayName = "Checkbox";

function handleTabKeyDown(event: ReactKeyboardEvent<HTMLButtonElement>) {
  const tabs = Array.from(event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]:not(:disabled)') || []);
  const currentIndex = tabs.indexOf(event.currentTarget);
  let nextIndex = currentIndex;
  if (event.key === "ArrowRight" || event.key === "ArrowDown") nextIndex = (currentIndex + 1) % tabs.length;
  else if (event.key === "ArrowLeft" || event.key === "ArrowUp") nextIndex = (currentIndex - 1 + tabs.length) % tabs.length;
  else if (event.key === "Home") nextIndex = 0;
  else if (event.key === "End") nextIndex = tabs.length - 1;
  else return;
  event.preventDefault();
  tabs[nextIndex]?.focus();
  tabs[nextIndex]?.click();
}
export function Tabs<T extends string>({
  items,
  value,
  onValueChange,
  ariaLabel,
  className,
}: {
  items: Array<{ value: T; label: ReactNode; disabled?: boolean }>;
  value: T;
  onValueChange: (value: T) => void;
  ariaLabel: string;
  className?: string;
}) {
  return (
    <div role="tablist" aria-label={ariaLabel} className={cn("flex min-w-max gap-1 rounded-lg border border-gray-200 bg-white p-1", className)}>
      {items.map((item) => (
        <button
          key={item.value}
          type="button"
          role="tab"
          aria-selected={value === item.value}
          tabIndex={value === item.value ? 0 : -1}
          disabled={item.disabled}
          className={cn(
            "h-9 rounded-md px-3 text-sm font-semibold transition",
            value === item.value ? "bg-slate-950 text-white" : "text-slate-500 hover:bg-slate-50",
          )}
          onClick={() => onValueChange(item.value)}
          onKeyDown={handleTabKeyDown}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}

export function TableShell({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("fn-table-shell overflow-x-auto", className)} {...props} />;
}

type NoticeTone = "info" | "success" | "warning" | "danger";

const noticeToneClasses: Record<NoticeTone, string> = {
  info: "border-sky-200 bg-sky-50 text-sky-800",
  success: "border-emerald-200 bg-emerald-50 text-emerald-800",
  warning: "border-amber-200 bg-amber-50 text-amber-800",
  danger: "border-red-200 bg-red-50 text-red-800",
};

export function InlineNotice({
  children,
  tone = "info",
  onClose,
  className,
}: {
  children: ReactNode;
  tone?: NoticeTone;
  onClose?: () => void;
  className?: string;
}) {
  return (
    <div role={tone === "danger" ? "alert" : "status"} aria-live={tone === "danger" ? "assertive" : "polite"} className={cn("flex items-start gap-3 rounded-xl border px-4 py-3 text-sm font-semibold", noticeToneClasses[tone], className)}>
      <div className="min-w-0 flex-1 whitespace-pre-line">{children}</div>
      {onClose && <button type="button" aria-label="알림 닫기" className="shrink-0 text-lg leading-none opacity-70 hover:opacity-100" onClick={onClose}>×</button>}
    </div>
  );
}

export function LoadingState({ label = "불러오는 중입니다.", className }: { label?: ReactNode; className?: string }) {
  return (
    <div role="status" aria-live="polite" className={cn("flex min-h-28 items-center justify-center gap-3 rounded-xl border border-dashed border-gray-200 bg-gray-50 px-5 py-8 text-sm font-semibold text-gray-500", className)}>
      <span aria-hidden="true" className="h-4 w-4 animate-spin rounded-full border-2 border-gray-300 border-t-[#ff6a00]" />
      <span>{label}</span>
    </div>
  );
}

type NoticeItem = { id: number; message: ReactNode; tone: NoticeTone };
type NoticeOptions = { tone?: NoticeTone; duration?: number };

let noticeSequence = 0;
let notices: NoticeItem[] = [];
const noticeListeners = new Set<(items: NoticeItem[]) => void>();

function publishNotices() {
  noticeListeners.forEach((listener) => listener(notices));
}

function dismissNotice(id: number) {
  notices = notices.filter((notice) => notice.id !== id);
  publishNotices();
}

export function notify(message: ReactNode, { tone = "info", duration = 5000 }: NoticeOptions = {}) {
  const id = ++noticeSequence;
  notices = [...notices.slice(-3), { id, message, tone }];
  publishNotices();
  if (typeof window !== "undefined" && duration > 0) window.setTimeout(() => dismissNotice(id), duration);
  return id;
}

export function NoticeHost() {
  const [items, setItems] = useState<NoticeItem[]>(notices);

  useEffect(() => {
    noticeListeners.add(setItems);
    setItems(notices);
    return () => { noticeListeners.delete(setItems); };
  }, []);

  if (!items.length) return null;
  return (
    <div className="fixed bottom-5 right-5 z-[100] grid w-[min(28rem,calc(100vw-2.5rem))] gap-2" aria-label="알림">
      {items.map((notice) => <InlineNotice key={notice.id} tone={notice.tone} onClose={() => dismissNotice(notice.id)} className="bg-white shadow-xl">{notice.message}</InlineNotice>)}
    </div>
  );
}

type ModalSize = "sm" | "md" | "lg" | "xl" | "full" | "screen";

const modalSizes: Record<ModalSize, string> = {
  sm: "max-w-[420px]",
  md: "max-w-[560px]",
  lg: "max-w-[760px]",
  xl: "max-w-[960px]",
  full: "max-w-[1120px]",
  screen: "max-w-[1500px]",
};

export const modalInputClass =
  "h-10 w-full rounded-lg border border-gray-300 bg-white px-3 text-sm font-medium text-gray-900 outline-none placeholder:text-gray-400 focus:border-[#ff6a00] focus:ring-2 focus:ring-orange-100";

type CalendarInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "value" | "defaultValue" | "onChange" | "min" | "max"> & {
  mode?: CalendarInputMode;
  value?: string;
  defaultValue?: string;
  min?: string;
  max?: string;
  onValueChange?: (value: string) => void;
  wrapperClassName?: string;
};

export const CalendarInput = forwardRef<HTMLInputElement, CalendarInputProps>(function CalendarInput({
  mode = "date",
  value,
  defaultValue,
  onValueChange,
  wrapperClassName,
  className,
  name,
  min,
  max,
  disabled,
  readOnly,
  required,
  onBlur,
  onFocus,
  onKeyDown,
  maxLength,
  ...props
}, forwardedRef) {
  const controlled = value !== undefined;
  const initialValue = normalizeCalendarInput(value ?? defaultValue, mode, min, max) ?? "";
  const [uncontrolledValue, setUncontrolledValue] = useState(initialValue);
  const confirmedValue = controlled ? normalizeCalendarInput(value, mode, min, max) ?? "" : uncontrolledValue;
  const confirmedRef = useRef(confirmedValue);
  const confirmedModeRef = useRef(mode);
  const pendingControlledRef = useRef<string | null>(null);
  const [draft, setDraft] = useState(() => formatCalendarInputValue(confirmedValue, mode));
  const visibleRef = useRef<HTMLInputElement | null>(null);
  const pickerRef = useRef<HTMLInputElement | null>(null);
  useImperativeHandle(forwardedRef, () => visibleRef.current as HTMLInputElement);

  useEffect(() => {
    const pending = pendingControlledRef.current;
    pendingControlledRef.current = null;
    const rejectedControlledValue = controlled && pending !== null && pending !== confirmedValue;
    if (!rejectedControlledValue && confirmedValue === confirmedRef.current && mode === confirmedModeRef.current) return;
    confirmedRef.current = confirmedValue;
    confirmedModeRef.current = mode;
    setDraft(formatCalendarInputValue(confirmedValue, mode));
  });

  function commit(nextValue: string) {
    const normalized = normalizeCalendarInput(nextValue, mode, min, max);
    if (normalized === null) return false;
    const changed = normalized !== confirmedRef.current;
    confirmedRef.current = normalized;
    setDraft(formatCalendarInputValue(normalized, mode));
    if (!controlled) setUncontrolledValue(normalized);
    if (changed) {
      if (controlled) pendingControlledRef.current = normalized;
      onValueChange?.(normalized);
    }
    return true;
  }

  function restoreConfirmed() {
    setDraft(formatCalendarInputValue(confirmedRef.current, mode));
  }

  function handleKeyDown(event: ReactKeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter") {
      event.preventDefault();
      if (!commit(event.currentTarget.value)) {
        restoreConfirmed();
        return;
      }
    }
    onKeyDown?.(event);
  }

  function openPicker() {
    const picker = pickerRef.current;
    if (!picker) return;
    if (typeof picker.showPicker === "function") picker.showPicker();
    else picker.click();
  }

  return (
    <span className={cn("relative flex w-full max-w-full items-center", wrapperClassName)}>
      <input
        {...props}
        ref={visibleRef}
        type="text"
        inputMode="numeric"
        autoComplete="off"
        value={draft}
        className={cn(className, "pr-9")}
        disabled={disabled}
        readOnly={readOnly}
        required={required}
        maxLength={maxLength ?? (mode === "date" ? 10 : 7)}
        onChange={(event) => {
          const nextDraft = event.target.value;
          setDraft(nextDraft);
          if (!nextDraft || normalizeCalendarInput(nextDraft, mode, min, max) !== null) commit(nextDraft);
        }}
        onBlur={(event) => {
          if (!commit(event.currentTarget.value)) restoreConfirmed();
          onBlur?.(event);
        }}
        onFocus={onFocus}
        onKeyDown={handleKeyDown}
      />
      <button
        type="button"
        aria-label={mode === "month" ? "월 선택 달력 열기" : "날짜 선택 달력 열기"}
        className="absolute right-1 inline-flex h-7 w-7 items-center justify-center rounded-md text-gray-500 hover:bg-orange-50 hover:text-orange-600 disabled:cursor-not-allowed disabled:opacity-40"
        disabled={disabled || readOnly}
        onMouseDown={(event) => event.preventDefault()}
        onClick={openPicker}
      >
        <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="5" width="18" height="16" rx="2" />
          <path d="M16 3v4M8 3v4M3 11h18" />
        </svg>
      </button>
      <input
        ref={pickerRef}
        data-calendar-picker="true"
        aria-hidden="true"
        tabIndex={-1}
        type={mode}
        value={confirmedValue}
        min={min}
        max={max}
        disabled={disabled}
        readOnly={readOnly}
        className="pointer-events-none absolute h-px w-px opacity-0"
        onChange={(event) => commit(event.target.value)}
      />
      {name && <input type="hidden" name={name} value={confirmedValue} disabled={disabled} />}
    </span>
  );
});
CalendarInput.displayName = "CalendarInput";

export const modalSelectClass =
  "h-10 w-full rounded-lg border border-gray-300 bg-white px-3 text-sm font-medium text-gray-900 outline-none focus:border-[#ff6a00] focus:ring-2 focus:ring-orange-100";
export const modalTextareaClass =
  "min-h-24 w-full rounded-lg border border-gray-300 bg-white px-3 py-3 text-sm font-medium text-gray-900 outline-none placeholder:text-gray-400 focus:border-[#ff6a00] focus:ring-2 focus:ring-orange-100";

export const ModalShell = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement> & { size?: ModalSize }>(function ModalShell({
  className,
  size = "lg",
  ...props
}, ref) {
  return <div ref={ref} className={cn("relative w-full rounded-2xl border border-gray-200 bg-white p-6 shadow-xl", modalSizes[size], className)} {...props} />;
});
ModalShell.displayName = "ModalShell";

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
  titleId,
  descriptionId,
}: {
  title: ReactNode;
  description?: ReactNode;
  onClose?: () => void;
  className?: string;
  titleId?: string;
  descriptionId?: string;
}) {
  return (
    <div className={cn("flex items-start justify-between gap-4 border-b border-gray-200 pb-4", className)}>
      <div className="min-w-0">
        <h3 id={titleId} className="text-xl font-bold leading-tight text-gray-900">{title}</h3>
        {description && <div id={descriptionId} className="mt-1 text-[13px] font-medium leading-5 text-gray-500">{description}</div>}
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
  return <div className={cn("fixed inset-0 z-[120] flex items-start justify-center overflow-y-auto bg-gray-900/55 px-4 py-8", className)}>{children}</div>;
}

const modalStack: symbol[] = [];
let modalScrollLockCount = 0;
let previousBodyOverflow = "";

function modalFocusableElements(root: HTMLElement) {
  return Array.from(root.querySelectorAll<HTMLElement>(
    'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
  )).filter((element) => !element.hidden && element.getAttribute("aria-hidden") !== "true" && isVisibleElement(element));
}

function AccessibleModal({
  title,
  description,
  onClose,
  children,
  footer,
  size,
  className,
  overlayClassName,
  bodyClassName,
  headerClassName,
  footerClassName,
}: {
  title: ReactNode;
  description?: ReactNode;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  size: ModalSize;
  className?: string;
  overlayClassName?: string;
  bodyClassName?: string;
  headerClassName?: string;
  footerClassName?: string;
}) {
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const instanceRef = useRef<symbol | null>(null);
  const onCloseRef = useRef(onClose);
  const generatedId = useId();
  const titleId = `${generatedId}-title`;
  const descriptionId = `${generatedId}-description`;
  onCloseRef.current = onClose;
  if (!instanceRef.current) instanceRef.current = Symbol("modal");

  useEffect(() => {
    const id = instanceRef.current!;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    modalStack.push(id);
    if (modalScrollLockCount === 0) previousBodyOverflow = document.body.style.overflow;
    modalScrollLockCount += 1;
    document.body.style.overflow = "hidden";

    const focusTimer = window.setTimeout(() => {
      const dialog = dialogRef.current;
      if (!dialog || modalStack[modalStack.length - 1] !== id) return;
      if (document.activeElement instanceof HTMLElement && dialog.contains(document.activeElement)) return;
      const autoFocus = dialog.querySelector<HTMLElement>("[autofocus]");
      (autoFocus || modalFocusableElements(dialog)[0] || dialog).focus();
    }, 0);

    function onKeyDown(event: globalThis.KeyboardEvent) {
      if (modalStack[modalStack.length - 1] !== id) return;
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopImmediatePropagation();
        onCloseRef.current();
        return;
      }
      if (event.key !== "Tab") return;
      const dialog = dialogRef.current;
      if (!dialog) return;
      const focusable = modalFocusableElements(dialog);
      if (!focusable.length) {
        event.preventDefault();
        dialog.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && (document.activeElement === first || !dialog.contains(document.activeElement))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      window.clearTimeout(focusTimer);
      document.removeEventListener("keydown", onKeyDown, true);
      const index = modalStack.lastIndexOf(id);
      if (index >= 0) modalStack.splice(index, 1);
      modalScrollLockCount = Math.max(0, modalScrollLockCount - 1);
      if (modalScrollLockCount === 0) document.body.style.overflow = previousBodyOverflow;
      window.setTimeout(() => {
        if (previousFocus?.isConnected) previousFocus.focus();
      }, 0);
    };
  }, []);

  return (
    <ModalOverlay className={overlayClassName}>
      <ModalShell
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        tabIndex={-1}
        size={size}
        className={className}
      >
        <ModalHeader title={title} description={description} onClose={onClose} className={headerClassName} titleId={titleId} descriptionId={descriptionId} />
        <ModalBody className={bodyClassName}>{children}</ModalBody>
        {footer && <ModalFooter className={footerClassName}>{footer}</ModalFooter>}
      </ModalShell>
    </ModalOverlay>
  );
}

type ModalProps = {
  title: ReactNode;
  description?: ReactNode;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  size?: ModalSize;
  className?: string;
  bodyClassName?: string;
  headerClassName?: string;
  footerClassName?: string;
};

export function FormModal({ size = "lg", ...props }: ModalProps) {
  return <AccessibleModal size={size} {...props} />;
}

export function SelectionModal({ size = "xl", ...props }: ModalProps) {
  return <AccessibleModal size={size} overlayClassName="py-10" {...props} />;
}

export function ResponsiveToolPanel({
  mobileOpen,
  title,
  onClose,
  children,
  desktopClassName,
}: {
  mobileOpen: boolean;
  title: ReactNode;
  onClose: () => void;
  children: ReactNode;
  desktopClassName?: string;
}) {
  if (mobileOpen) {
    return (
      <AccessibleModal
        title={title}
        onClose={onClose}
        size="md"
        className="flex max-h-[92vh] flex-col overflow-hidden p-0"
        headerClassName="shrink-0 px-5 py-4"
        bodyClassName="min-h-0 flex-1 overflow-y-auto px-4 py-4"
      >
        {children}
      </AccessibleModal>
    );
  }

  return <aside className={cn("hidden w-[320px] shrink-0 border-l px-4 py-6 xl:block", desktopClassName)}>{children}</aside>;
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

    function onKeyDown(event: globalThis.KeyboardEvent) {
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
