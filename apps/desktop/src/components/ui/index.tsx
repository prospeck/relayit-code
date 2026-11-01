import {
  forwardRef,
  useRef,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type TextareaHTMLAttributes,
} from "react";
import * as SwitchPrimitive from "@radix-ui/react-switch";
import * as SelectPrimitive from "@radix-ui/react-select";
import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { Check, ChevronDown, Loader2, X } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { SERVICE_COLORS } from "@relayit/shared";
import { cx } from "../../lib/format";

/* ───────────── Button ───────────── */

type Variant = "primary" | "secondary" | "ghost" | "danger" | "quiet";
type Size = "sm" | "md" | "lg";

const variants: Record<Variant, string> = {
  primary:
    "bg-accent text-on-accent hover:bg-accent-hover active:bg-accent-press shadow-[inset_0_1px_0_rgb(255_255_255/0.18),0_1px_2px_rgb(0_0_0/0.12)]",
  secondary: "bg-surface text-ink border border-line-strong hover:bg-surface-2 shadow-sm",
  ghost: "text-ink-2 hover:bg-surface-3/70 hover:text-ink",
  danger: "bg-surface text-danger border border-line-strong hover:bg-danger-soft",
  quiet: "bg-surface-2 text-ink hover:bg-surface-3",
};
const sizes: Record<Size, string> = {
  sm: "h-7 px-2.5 text-[12.5px] gap-1.5 rounded-[9px]",
  md: "h-9 px-3.5 text-[13.5px] gap-2 rounded-[11px]",
  lg: "h-11 px-5 text-[14.5px] gap-2 rounded-[13px]",
};

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  icon?: ReactNode;
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "secondary", size = "md", loading, icon, className, children, disabled, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      disabled={disabled || loading}
      className={cx(
        "inline-flex items-center justify-center font-medium whitespace-nowrap select-none transition-[background,color,box-shadow,transform] duration-150 active:scale-[0.98] disabled:opacity-45 disabled:pointer-events-none",
        variants[variant],
        sizes[size],
        className,
      )}
      {...rest}
    >
      {loading ? <Loader2 className="size-4 animate-spin" /> : icon}
      {children}
    </button>
  );
});

export const IconButton = forwardRef<
  HTMLButtonElement,
  ButtonHTMLAttributes<HTMLButtonElement> & { label: string; size?: "sm" | "md" }
>(function IconButton({ label, className, size = "md", children, ...rest }, ref) {
  return (
    <Tooltip label={label}>
      <button
        ref={ref}
        aria-label={label}
        className={cx(
          "inline-flex items-center justify-center rounded-[9px] text-muted hover:text-ink hover:bg-surface-3/70 transition-colors",
          size === "sm" ? "size-7" : "size-8",
          className,
        )}
        {...rest}
      >
        {children}
      </button>
    </Tooltip>
  );
});

/* ───────────── Inputs ───────────── */

const fieldBase =
  "w-full bg-surface text-ink placeholder:text-faint border border-control rounded-[11px] px-3 transition-[border,box-shadow] duration-150 outline-none focus:border-accent focus:shadow-[var(--ring)]";

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  function Input({ className, ...rest }, ref) {
    return <input ref={ref} className={cx(fieldBase, "h-10 text-[14px]", className)} {...rest} />;
  },
);

export const Textarea = forwardRef<
  HTMLTextAreaElement,
  TextareaHTMLAttributes<HTMLTextAreaElement>
>(function Textarea({ className, ...rest }, ref) {
  return (
    <textarea
      ref={ref}
      className={cx(fieldBase, "py-2.5 text-[14px] leading-relaxed resize-none", className)}
      {...rest}
    />
  );
});

export function Field({
  label,
  hint,
  error,
  children,
  className,
}: {
  label: string;
  hint?: ReactNode;
  error?: string | null;
  children: ReactNode;
  className?: string;
}) {
  return (
    <label className={cx("block", className)}>
      <span className="block text-[12.5px] font-medium text-ink-2 mb-1.5">{label}</span>
      {children}
      {error ? (
        <span className="block text-[12px] text-danger mt-1.5">{error}</span>
      ) : hint ? (
        <span className="block text-[12px] text-muted mt-1.5">{hint}</span>
      ) : null}
    </label>
  );
}

/* ───────────── Surfaces ───────────── */

export function Card({ className, children, ...rest }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cx(
        "bg-surface border border-line rounded-[var(--radius-card)] shadow-sm",
        className,
      )}
      {...rest}
    >
      {children}
    </div>
  );
}

export function SectionTitle({
  children,
  action,
  className,
}: {
  children: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cx("flex items-center justify-between mb-3", className)}>
      <h2 className="text-[12px] font-semibold uppercase tracking-[0.08em] text-muted">
        {children}
      </h2>
      {action}
    </div>
  );
}

export function Badge({
  tone = "neutral",
  children,
  className,
}: {
  tone?: "neutral" | "accent" | "success" | "warning" | "danger" | "info";
  children: ReactNode;
  className?: string;
}) {
  const tones = {
    neutral: "bg-surface-2 text-ink-2 border-line",
    accent: "bg-accent-soft text-accent-text border-transparent",
    success: "bg-success-soft text-success border-transparent",
    warning: "bg-warning-soft text-warning border-transparent",
    danger: "bg-danger-soft text-danger border-transparent",
    info: "bg-info-soft text-info border-transparent",
  };
  return (
    <span
      className={cx(
        "inline-flex items-center gap-1 h-[22px] px-2 rounded-full text-[11.5px] font-medium border",
        tones[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

export function ClassBadge({ value }: { value: string | null }) {
  if (!value) return null;
  const color =
    value === "act"
      ? "var(--class-act)"
      : value === "prepare"
        ? "var(--class-prepare)"
        : "var(--class-read)";
  return (
    <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-muted uppercase tracking-wider">
      <span className="size-1.5 rounded-full" style={{ background: color }} />
      {value}
    </span>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="inline-flex items-center h-5 min-w-5 justify-center px-1.5 rounded-[6px] bg-surface-2 border border-line text-[11px] text-muted font-sans">
      {children}
    </kbd>
  );
}

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cx("size-4 animate-spin text-muted", className)} />;
}

/** A small colored mark for a service (Gmail, Swiggy…). Falls back to the first letter. */
export function ServiceMark({ service, size = 20 }: { service: string; size?: number }) {
  const key = Object.keys(SERVICE_COLORS).find((k) =>
    service.toLowerCase().includes(k.toLowerCase()),
  );
  const color = key ? SERVICE_COLORS[key] : "var(--muted)";
  return (
    <span
      className="inline-flex items-center justify-center rounded-[6px] text-white font-semibold shrink-0"
      style={{ width: size, height: size, background: color, fontSize: size * 0.5 }}
      aria-hidden
    >
      {(key ?? service).charAt(0).toUpperCase()}
    </span>
  );
}

export function EmptyState({
  icon,
  title,
  body,
  action,
}: {
  icon: ReactNode;
  title: string;
  body: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center text-center py-16 px-6">
      <div className="size-12 rounded-2xl bg-surface-2 border border-line flex items-center justify-center text-muted mb-4">
        {icon}
      </div>
      <h3 className="text-[15px] font-semibold mb-1">{title}</h3>
      <p className="text-muted text-[13.5px] max-w-sm leading-relaxed">{body}</p>
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

/* ───────────── Switch ───────────── */

export function Switch({
  checked,
  onCheckedChange,
  disabled,
  label,
}: {
  checked: boolean;
  onCheckedChange: (v: boolean) => void;
  disabled?: boolean;
  label?: string;
}) {
  return (
    <SwitchPrimitive.Root
      checked={checked}
      onCheckedChange={onCheckedChange}
      disabled={disabled}
      aria-label={label}
      className="relative h-[24px] w-[40px] rounded-full bg-surface-3 border border-control data-[state=checked]:bg-accent data-[state=checked]:border-transparent transition-colors disabled:opacity-50 shrink-0"
    >
      <SwitchPrimitive.Thumb className="block size-[16px] rounded-full bg-white shadow-sm translate-x-[3px] data-[state=checked]:translate-x-[19px] transition-transform duration-200 ease-[var(--ease-out-soft)]" />
    </SwitchPrimitive.Root>
  );
}

/* ───────────── Select ───────────── */

export function Select({
  value,
  onValueChange,
  options,
  placeholder,
  className,
}: {
  value: string | undefined;
  onValueChange: (v: string) => void;
  options: { value: string; label: string; hint?: string }[];
  placeholder?: string;
  className?: string;
}) {
  return (
    <SelectPrimitive.Root value={value} onValueChange={onValueChange}>
      <SelectPrimitive.Trigger
        className={cx(
          fieldBase,
          "h-10 flex items-center justify-between text-[14px] text-left",
          className,
        )}
      >
        <SelectPrimitive.Value
          placeholder={<span className="text-faint">{placeholder ?? "Choose…"}</span>}
        />
        <SelectPrimitive.Icon>
          <ChevronDown className="size-4 text-muted" />
        </SelectPrimitive.Icon>
      </SelectPrimitive.Trigger>
      <SelectPrimitive.Portal>
        <SelectPrimitive.Content
          position="popper"
          sideOffset={6}
          className="z-50 max-h-[320px] min-w-[var(--radix-select-trigger-width)] overflow-hidden bg-surface border border-line-strong rounded-[12px] shadow-lg"
        >
          <SelectPrimitive.Viewport className="p-1">
            {options.map((o) => (
              <SelectPrimitive.Item
                key={o.value}
                value={o.value}
                className="relative flex items-center gap-2 h-9 pl-8 pr-3 rounded-[8px] text-[13.5px] outline-none data-[highlighted]:bg-surface-2 data-[state=checked]:font-medium"
              >
                <SelectPrimitive.ItemIndicator className="absolute left-2.5">
                  <Check className="size-3.5 text-accent" />
                </SelectPrimitive.ItemIndicator>
                <SelectPrimitive.ItemText>{o.label}</SelectPrimitive.ItemText>
                {o.hint && <span className="ml-auto text-[11.5px] text-muted">{o.hint}</span>}
              </SelectPrimitive.Item>
            ))}
          </SelectPrimitive.Viewport>
        </SelectPrimitive.Content>
      </SelectPrimitive.Portal>
    </SelectPrimitive.Root>
  );
}

/* ───────────── Segmented control ───────────── */

export function Segmented<T extends string>({
  value,
  onChange,
  options,
  label,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: ReactNode }[];
  label?: string;
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className="inline-flex p-[3px] rounded-[11px] bg-surface-2 border border-line"
    >
      {options.map((o) => (
        <button
          key={o.value}
          onClick={() => onChange(o.value)}
          aria-pressed={value === o.value}
          className={cx(
            "relative h-7 px-3 text-[12.5px] font-medium rounded-[8px] transition-colors",
            value === o.value ? "text-ink" : "text-muted hover:text-ink",
          )}
        >
          {value === o.value && (
            <motion.span
              layoutId="seg"
              className="absolute inset-0 bg-surface rounded-[8px] shadow-sm border border-line"
              transition={{ type: "spring", bounce: 0.15, duration: 0.35 }}
            />
          )}
          <span className="relative">{o.label}</span>
        </button>
      ))}
    </div>
  );
}

/* ───────────── Tooltip ───────────── */

export function Tooltip({
  label,
  children,
  side = "top",
}: {
  label: ReactNode;
  children: ReactNode;
  side?: "top" | "right" | "bottom" | "left";
}) {
  return (
    <TooltipPrimitive.Root delayDuration={350}>
      <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Content
          side={side}
          sideOffset={6}
          className="z-50 px-2 py-1 rounded-[7px] bg-ink text-bg text-[12px] font-medium shadow-md max-w-xs"
        >
          {label}
        </TooltipPrimitive.Content>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  );
}
export const TooltipProvider = TooltipPrimitive.Provider;

/* ───────────── Dialog ───────────── */

export function Dialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  width = 480,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  title: string;
  description?: ReactNode;
  children: ReactNode;
  width?: number;
}) {
  // Dialogs here are opened from state, not a Radix Trigger, so remember and restore the opener's focus.
  // Captured during render, before Radix moves focus into the dialog.
  const opener = useRef<HTMLElement | null>(null);
  const wasOpen = useRef(false);
  if (open && !wasOpen.current && typeof document !== "undefined")
    opener.current = document.activeElement as HTMLElement | null;
  wasOpen.current = open;
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <AnimatePresence>
        {open && (
          <DialogPrimitive.Portal forceMount>
            <DialogPrimitive.Overlay asChild>
              <motion.div
                className="fixed inset-0 z-40 bg-[var(--scrim)] backdrop-blur-[2px]"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.15 }}
              />
            </DialogPrimitive.Overlay>
            <DialogPrimitive.Content
              asChild
              onOpenAutoFocus={(e) => {
                // Start on the first field rather than the Close button.
                const field = (e.currentTarget as HTMLElement | null)?.querySelector<HTMLElement>(
                  "input:not([type=hidden]), textarea, [role=combobox]",
                );
                if (field) {
                  e.preventDefault();
                  field.focus();
                }
              }}
              onCloseAutoFocus={(e) => {
                if (opener.current?.isConnected) {
                  e.preventDefault();
                  opener.current.focus();
                }
              }}
            >
              <motion.div
                className="fixed z-50 left-1/2 top-[14vh] -translate-x-1/2 bg-surface border border-line rounded-[18px] shadow-lg p-6 max-h-[76vh] overflow-y-auto"
                style={{ width: `min(${width}px, calc(100vw - 48px))` }}
                initial={{ opacity: 0, y: 8, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 4, scale: 0.98 }}
                transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
              >
                <div className="flex items-start justify-between gap-4 mb-4">
                  <div>
                    <DialogPrimitive.Title className="text-[17px] font-semibold tracking-tight">
                      {title}
                    </DialogPrimitive.Title>
                    {description && (
                      <DialogPrimitive.Description className="text-muted text-[13.5px] mt-1">
                        {description}
                      </DialogPrimitive.Description>
                    )}
                  </div>
                  {/* Plain button (no tooltip): a focused tooltip would swallow the first Escape. */}
                  <DialogPrimitive.Close
                    aria-label="Close"
                    className="inline-flex items-center justify-center size-7 rounded-[9px] text-muted hover:text-ink hover:bg-surface-3/70 transition-colors shrink-0"
                  >
                    <X className="size-4" />
                  </DialogPrimitive.Close>
                </div>
                {children}
              </motion.div>
            </DialogPrimitive.Content>
          </DialogPrimitive.Portal>
        )}
      </AnimatePresence>
    </DialogPrimitive.Root>
  );
}

/* ───────────── Page scaffold ───────────── */

export function Page({
  title,
  subtitle,
  actions,
  children,
  width = 880,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  width?: number;
}) {
  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto px-10 pt-14 pb-20" style={{ maxWidth: width + 80 }}>
        <header className="flex items-end justify-between gap-6 mb-8">
          <div>
            <h1 className="font-display text-[34px] leading-[1.1] text-ink">{title}</h1>
            {subtitle && <p className="text-muted text-[14px] mt-2 max-w-xl">{subtitle}</p>}
          </div>
          {actions && <div className="flex items-center gap-2 shrink-0">{actions}</div>}
        </header>
        {children}
      </div>
    </div>
  );
}
