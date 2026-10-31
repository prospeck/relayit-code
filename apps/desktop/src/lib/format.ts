import { formatInr } from "@relayit/shared";
export { formatInr };

export function timeOfDay(d = new Date()): "morning" | "afternoon" | "evening" | "night" {
  const h = d.getHours();
  return h < 5 ? "night" : h < 12 ? "morning" : h < 17 ? "afternoon" : h < 22 ? "evening" : "night";
}

export function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" }).replace(" ", " ").toLowerCase();
}

export function fmtDay(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  const yest = new Date(Date.now() - 86_400_000);
  if (d.toDateString() === today.toDateString()) return "Today";
  if (d.toDateString() === yest.toDateString()) return "Yesterday";
  return d.toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" });
}

export function relTime(iso: string): string {
  const s = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 45) return "just now";
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86_400) return `${Math.round(s / 3600)}h ago`;
  return fmtDay(iso);
}

export function untilLabel(iso: string): string {
  const s = Math.round((new Date(iso).getTime() - Date.now()) / 1000);
  if (s <= 0) return "expired";
  if (s < 60) return `${s}s left`;
  return `${Math.ceil(s / 60)} min left`;
}

export const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(" ");
