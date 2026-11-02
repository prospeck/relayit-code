export const RELAY_MARK_PATH = "M21 45V19h12.5a8.5 8.5 0 0 1 0 17H27m7 0 9.5 9";

export function RelayMark({ ink = "#ffffff" }: { ink?: string }) {
  return <path d={RELAY_MARK_PATH} fill="none" stroke={ink} strokeWidth="5.5" strokeLinecap="round" strokeLinejoin="round" />;
}
