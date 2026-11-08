// A button that acts only once it has been held: money and sends are never one stray click. The fill runs across the
// pill while it is held and drains when let go early. Space or Enter held does the same from the keyboard.
import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { cn } from "@/lib/cn";

export const HOLD_MS = 800;

export function HoldButton({
  onConfirm,
  children,
  holdingLabel,
  hint,
  disabled = false,
  className,
  ...rest
}: {
  onConfirm: () => void;
  children: ReactNode;
  /** Said while the hold runs, for screen readers and as the label. */
  holdingLabel: string;
  /** How to use it, read after the label. */
  hint: string;
  disabled?: boolean;
  className?: string;
  [data: `data-${string}`]: string | undefined;
}) {
  const [holding, setHolding] = useState(false);
  const timer = useRef<number | null>(null);
  const done = useRef(false);

  const stop = () => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
    setHolding(false);
  };
  const start = () => {
    if (disabled || timer.current !== null || done.current) return;
    setHolding(true);
    timer.current = window.setTimeout(() => {
      timer.current = null;
      done.current = true;
      setHolding(false);
      onConfirm();
    }, HOLD_MS);
  };
  useEffect(() => () => { if (timer.current !== null) window.clearTimeout(timer.current); }, []);

  const keyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key !== " " && event.key !== "Enter") return;
    event.preventDefault();
    if (!event.repeat) start();
  };
  const keyUp = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === " " || event.key === "Enter") stop();
  };

  return (
    <button
      {...rest}
      type="button"
      disabled={disabled}
      aria-description={hint}
      onPointerDown={(event) => { if (event.button === 0) start(); }}
      onPointerUp={stop}
      onPointerLeave={stop}
      onPointerCancel={stop}
      onKeyDown={keyDown}
      onKeyUp={keyUp}
      onBlur={stop}
      onContextMenu={(event) => event.preventDefault()}
      className={cn(
        "relative isolate inline-flex h-10 select-none items-center justify-center overflow-hidden rounded-full bg-accent px-5 text-[14px] font-semibold text-[color:var(--color-accent-ink)] touch-none",
        "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus disabled:opacity-50",
        className,
      )}
    >
      <span
        aria-hidden="true"
        className="absolute inset-y-0 left-0 -z-10 bg-ink/25"
        style={{
          width: holding ? "100%" : "0%",
          transition: holding ? `width ${HOLD_MS}ms linear` : "width 180ms ease-out",
        }}
      />
      <span aria-live="polite">{holding ? holdingLabel : children}</span>
    </button>
  );
}
