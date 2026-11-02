// Adapted from pingdotgg/t3code@00cdceb1 apps/web/src/components/preview/AgentBrowserCursor.tsx (AgentCursorMark) and
// agentBrowserCursorLogic.ts, MIT License, Copyright (c) 2026 T3 Tools Inc. (full text in third_party/t3-code/LICENSE);
// modified: RelayIt colours and baton pointer.

import { useEffect, useState } from "react";
import { MAUS_COLORS, type MausColor } from "@/lib/mascot";
import { RelayMark } from "../RelayMark";

const CURSOR_ACTIVE_MS = 700;

export type CursorController = "human" | "agent" | "none";

export function agentCursorOpacity(active: boolean, controller: CursorController): number {
  if (active) return 1;
  return controller === "human" ? 0.18 : 0.35;
}

/** The bot's pointer at a surface position; it fades once the bot stops acting. */
export function AgentCursor({ phase, sequence, left, top, controller, color }: {
  phase: "move" | "click";
  sequence: number;
  left: number;
  top: number;
  controller: CursorController;
  color?: MausColor;
}) {
  const [inactiveSequence, setInactiveSequence] = useState<number | null>(null);
  const active = inactiveSequence !== sequence;
  useEffect(() => {
    const timeout = window.setTimeout(() => setInactiveSequence(sequence), CURSOR_ACTIVE_MS);
    return () => window.clearTimeout(timeout);
  }, [sequence]);
  return (
    <div
      className="pointer-events-none absolute left-0 top-0 z-30 transition-[opacity,transform] duration-150 ease-out motion-reduce:transition-none"
      style={{ opacity: agentCursorOpacity(active, controller), transform: `translate3d(${left}px, ${top}px, 0)` }}
      aria-hidden="true"
      data-agent-cursor
    >
      {phase === "click" ? <span key={sequence} className="absolute left-0.5 top-0.5 size-4 animate-ping rounded-full bg-accent/25 motion-reduce:animate-none" /> : null}
      <svg width="34" height="38" viewBox="0 0 34 38" className="relative -translate-x-0.5 -translate-y-0.5 drop-shadow-sm">
        <path d="M2 2v18l5-5 9 1Z" fill={color ? MAUS_COLORS[color] : "#D9481F"} stroke="#fff" strokeWidth="1.5" strokeLinejoin="round" />
        <g transform="translate(7 11) scale(.4)">
          <rect width="64" height="64" rx="17" fill={color ? MAUS_COLORS[color] : "#D9481F"} stroke="#fff" strokeWidth="3" />
          <RelayMark ink={color === "silver" || color === "chrome" || color === "yellow" ? "#202A35" : "#ffffff"} />
        </g>
      </svg>
    </div>
  );
}
