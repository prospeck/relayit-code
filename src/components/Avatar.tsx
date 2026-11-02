import { forwardRef, memo, useEffect, useState, type ReactNode } from "react";
import { cn } from "@/lib/cn";
import { MAUS_COLORS, type MausColor, type MausMotion, type MausState } from "@/lib/mascot";
import { avatarCropRadius, botAvatarProfile, clampAvatarFocus, clampAvatarZoom, type BotAvatarCrop, type MascotFaceColor } from "../../shared/bot-avatar";
import type { BotBodyId } from "../../shared/bot-body";
import { useHalloweenDressed, wornBody } from "@/lib/halloween-dress";
import { RelayToken, type RelayTokenHandle } from "./RelayToken";

export type MausAvatarHandle = RelayTokenHandle;

export function roomAvatarGradient(color: MausColor): [string, string, string] {
  const fill = `var(--identity-${color})`;
  return [fill, fill, fill];
}

export type MausAvatarProps = {
  color: MausColor;
  state?: MausState;
  expression?: number;
  size?: number;
  label?: string;
  motion?: MausMotion;
  motionKey?: number;
  turn?: number;
  gaze?: { x?: number; y?: number };
  spring?: number;
  eyeScale?: number;
  showMouth?: boolean;
  mouthStroke?: number;
  forward?: boolean;
  lookAround?: number;
  trackPointer?: boolean;
  animated?: boolean;
  bodyId?: BotBodyId;
  gradient?: [string, string, string];
  faceColor?: MascotFaceColor | null;
};


export const MausAvatar = memo(forwardRef<MausAvatarHandle, MausAvatarProps>(function RelayAvatar(props, ref) {
  const fill = MAUS_COLORS[props.color] ?? MAUS_COLORS.green;
  const gradient: [string, string, string] = props.gradient ?? [fill, fill, fill];
  return <RelayToken ref={ref} color={props.color} gradient={gradient} bodyId={props.bodyId} state={props.state}
    size={props.size} label={props.label} animated={props.animated} motion={props.motion}
    motionKey={props.motionKey} ink={props.faceColor === "black" ? "#000000" : props.faceColor === "white" ? "#ffffff" : undefined} />;
}));

export type BotAvatarProps = Omit<MausAvatarProps, "color" | "gradient"> & {
  readable?: boolean;
  bot: {
    name?: string;
    color: MausColor;
    avatarUrl?: string | null;
    avatarCrop?: BotAvatarCrop;
    avatarZoom?: number;
    avatarFocusX?: number;
    avatarFocusY?: number;
    mascotBody?: BotBodyId | null;
    mascotFaceColor?: MascotFaceColor | null;
  };
};

export type BotAvatarOutcome = "flatImage" | "gradientMascot";

/** Mirrored name for name by resolveBotAvatarOutcome in ios/Sources/CompanionCore/BotAvatarRendering.swift. */
export function resolveBotAvatarOutcome(params: {
  avatarCrop: BotAvatarCrop;
  hasUrl: boolean;
  imageFailed: boolean;
}): BotAvatarOutcome {
  const { avatarCrop, hasUrl, imageFailed } = params;
  if (!hasUrl) return "gradientMascot";
  if (avatarCrop === "mascot") return "gradientMascot";
  if (imageFailed) return "gradientMascot";
  return "flatImage";
}

export function BotAvatar({ bot, size = 44, label, readable = false, ...mascotProps }: BotAvatarProps) {
  const profile = botAvatarProfile(bot);
  const dressed = useHalloweenDressed();
  const [imageFailed, setImageFailed] = useState(false);

  useEffect(() => setImageFailed(false), [profile.avatarUrl]);

  const outcome = resolveBotAvatarOutcome({
    avatarCrop: profile.avatarCrop,
    hasUrl: Boolean(profile.avatarUrl),
    imageFailed,
  });

  if (outcome !== "flatImage") {
    return (
      <MausAvatar
        bodyId={wornBody(bot.mascotBody, bot.color, dressed)}
        {...mascotProps}
        color={bot.color}
        faceColor={bot.mascotFaceColor}
        gradient={readable ? roomAvatarGradient(bot.color) : undefined}
        size={size}
        label={label ?? bot.name}
      />
    );
  }

  const radius = avatarCropRadius(profile.avatarCrop);
  const zoom = clampAvatarZoom(bot.avatarZoom ?? 1);
  const focusX = clampAvatarFocus(bot.avatarFocusX ?? 0.5);
  const focusY = clampAvatarFocus(bot.avatarFocusY ?? 0.5);
  const origin = `${focusX * 100}% ${focusY * 100}%`;
  return (
    <span
      className="relative block shrink-0 overflow-hidden bg-raised"
      style={{ width: size, height: size, borderRadius: radius }}
    >
      <img
        src={profile.avatarUrl}
        alt={label ?? (bot.name ? `${bot.name} avatar` : "Bot avatar")}
        width={size}
        height={size}
        draggable={false}
        onError={() => setImageFailed(true)}
        className="block size-full max-w-none object-cover"
        style={{
          width: size,
          height: size,
          objectPosition: origin,
          transform: zoom === 1 ? undefined : `scale(${zoom})`,
          transformOrigin: origin,
        }}
      />
    </span>
  );
}

export function InitialsAvatar({
  initials,
  avatarUrl,
  size = 32,
  fallback,
  fontSize,
  className,
}: {
  initials: string;
  avatarUrl?: string;
  size?: number;
  className?: string;
  /** drawn instead of the initials, for a person with no name or email to take them from */
  fallback?: ReactNode;
  fontSize?: number;
}) {
  // A picture that is gone (a restored backup carries the address, not the file) falls back to the initials.
  const [failed, setFailed] = useState<string | null>(null);
  if (avatarUrl && failed !== avatarUrl) {
    return <img src={avatarUrl} alt="" onError={() => setFailed(avatarUrl)} className={cn("shrink-0 rounded-full object-cover", className)} style={{ width: size, height: size }} />;
  }
  return (
    <div
      className={cn("flex shrink-0 items-center justify-center rounded-full bg-raised text-ink-secondary font-medium", className)}
      style={{ width: size, height: size, fontSize: fontSize ?? size * 0.38 }}
    >
      {fallback ?? initials}
    </div>
  );
}
