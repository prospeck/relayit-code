/** The RelayIt mark: an "R" whose leg hands off forward, like a relay baton. */
export function LogoMark({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden>
      <defs>
        <linearGradient id="rl-g" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#F07040" />
          <stop offset="1" stopColor="#D9481F" />
        </linearGradient>
      </defs>
      <rect width="64" height="64" rx="17" fill="url(#rl-g)" />
      <path
        d="M21 45V19h12.5a8.5 8.5 0 0 1 0 17H27m7 0 9.5 9"
        fill="none"
        stroke="#fff"
        strokeWidth="5.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function Wordmark() {
  return (
    <span className="flex items-center gap-2">
      <LogoMark size={22} />
      <span className="text-[15px] font-semibold tracking-[-0.02em]">RelayIt</span>
    </span>
  );
}
