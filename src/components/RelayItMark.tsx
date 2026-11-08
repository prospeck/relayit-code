// The RelayIt mark and wordmark, drawn from shared/brand-mark.ts so the app, the icon and the splash never drift.
import { cn } from "@/lib/cn";
import {
  LANE_COLORS,
  LANE_RUNNER,
  LANE_STROKE,
  LANE_TRACK,
  WORDMARK_IT_PATH,
  WORDMARK_RELAY_PATH,
  WORDMARK_VIEWBOX,
} from "../../shared/brand-mark";

/** The track in ink with the runner in the accent; `tile` puts it on the coral app-icon square instead. `animated` draws
 * the track and sends the runner once round it into the open quarter, as the launch screen does. */
export function LaneMark({ size = 24, tile = false, animated = false, className }: { size?: number; tile?: boolean; animated?: boolean; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" className={cn("shrink-0 overflow-visible", animated && "lane-animated", className)} aria-hidden>
      {tile && <rect width="64" height="64" rx="15" fill={LANE_COLORS.coral} />}
      <path
        className="lane-track"
        pathLength={132}
        d={LANE_TRACK}
        fill="none"
        stroke={tile ? LANE_COLORS.white : "var(--color-ink)"}
        strokeWidth={LANE_STROKE}
        strokeLinecap="round"
      />
      <circle className="lane-runner" {...LANE_RUNNER} fill={tile ? LANE_COLORS.black : "var(--color-accent)"} />
    </svg>
  );
}

/** "RelayIt" in its outlined Unbounded letters; height sets the size. Screen readers get the name once. */
export function Wordmark({ height = 18, className }: { height?: number; className?: string }) {
  return (
    <svg height={height} viewBox={WORDMARK_VIEWBOX} className={cn("w-auto shrink-0", className)} role="img" aria-label="RelayIt">
      <path d={WORDMARK_RELAY_PATH} fill="var(--color-ink)" />
      <path d={WORDMARK_IT_PATH} fill="var(--color-accent)" />
    </svg>
  );
}
