import { forwardRef, useEffect, useId, useImperativeHandle, useState } from "react";
import { MASCOT_BODIES, botMascotBody } from "../../shared/relay-tokens";
import { HALLOWEEN_BODY_IDS } from "../../shared/seasonal-tokens";
import type { BotBodyId } from "../../shared/bot-body";
import type { MausColor, MausMotion, MausState } from "@/lib/mascot";
import { tokenActivity, type TokenActivity } from "@/lib/token-state";
import { t } from "@/lib/i18n";
import { usePrefersReducedMotion } from "./mascot-clock";
import { RelayMark } from "./RelayMark";

export interface RelayTokenHandle {
  blink(): void;
  spin(durationMs?: number): void;
  setExpression(index: number): void;
}

interface RelayTokenProps {
  color: MausColor;
  gradient: [string, string, string];
  bodyId?: BotBodyId;
  state?: MausState;
  motion?: MausMotion;
  motionKey?: number;
  size?: number;
  label?: string;
  animated?: boolean;
  ink?: string;
}

const SIGNALS: Record<TokenActivity, string> = {
  idle: "M47 51h6",
  working: "M46 51h9m-4-4 4 4-4 4",
  waiting: "M48 47v8m5-8v8",
  attention: "M51 46v6m0 3v.2",
  complete: "M46 51l3 3 6-7",
};

const MOTION_SIGNAL: Partial<Record<MausMotion, TokenActivity>> = {
  thinking: "waiting", alert: "attention", failure: "attention", surprise: "attention",
  working: "working", launch: "working", success: "complete", celebrate: "complete",
};

export const RelayToken = forwardRef<RelayTokenHandle, RelayTokenProps>(function RelayToken({
  color, gradient, bodyId, state = "idle", motion = "none", motionKey = 0,
  size = 44, label, animated = true, ink,
}, ref) {
  const id = `relay-${useId().replace(/:/g, "")}`;
  const reduced = usePrefersReducedMotion();
  const [feedback, setFeedback] = useState(0);
  const [override, setOverride] = useState<TokenActivity | null>(null);
  useImperativeHandle(ref, () => ({
    blink: () => setFeedback((n) => n + 1),
    spin: () => setFeedback((n) => n + 1),
    setExpression: (index) => setOverride((["idle", "working", "waiting", "attention", "complete"] as const)[Math.abs(index) % 5]!),
  }), []);
  useEffect(() => {
    if (motion === "none" || !animated) { setOverride(null); return; }
    setOverride(MOTION_SIGNAL[motion] ?? null);
    setFeedback((n) => n + 1);
    const timer = setTimeout(() => setOverride(null), 1400);
    return () => clearTimeout(timer);
  }, [motion, motionKey, animated]);
  const activity = override ?? tokenActivity(state);
  const seasonalIndex = (HALLOWEEN_BODY_IDS as readonly unknown[]).indexOf(bodyId);
  const body = seasonalIndex < 0 ? MASCOT_BODIES[botMascotBody(bodyId)] : Object.values(MASCOT_BODIES)[seasonalIndex]!;
  const markInk = ink ?? (color === "chrome" || color === "silver" || color === "yellow" ? "#202A35" : "#ffffff");
  const stateLabel = t(`relayToken.state.${activity}`);
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" className="relay-token shrink-0 overflow-visible"
      role="img" aria-label={label ? `${label} · ${stateLabel}` : stateLabel}
      data-relay-token={body.id} data-activity={activity} data-animated={animated && !reduced ? "true" : "false"}>
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
          <stop stopColor={`color-mix(in srgb, ${gradient[0]} 84%, white)`} />
          <stop offset=".55" stopColor={gradient[1]} />
          <stop offset="1" stopColor={`color-mix(in srgb, ${gradient[2]} 88%, black)`} />
        </linearGradient>
      </defs>
      <g key={feedback} className={feedback ? "relay-token-surface relay-token-cue" : "relay-token-surface"}>
        <path d={body.outline} fill={`url(#${id})`} stroke="var(--color-panel, #fff)" strokeWidth="1.5" />
        <RelayMark ink={markInk} />
        {seasonalIndex >= 0 && <path d="M18 11h10m-10 3h6" stroke={markInk} strokeWidth="1.2" strokeLinecap="round" opacity=".5" />}
      </g>
      <g className="relay-token-signal" transform="translate(3 3)">
        <circle cx="51" cy="51" r="10" fill="var(--color-panel, #fff)" />
        <circle cx="51" cy="51" r="8" fill={gradient[1]} />
        <path d={SIGNALS[activity]} fill="none" stroke={markInk} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className="relay-token-signal-mark" />
      </g>
    </svg>
  );
});
