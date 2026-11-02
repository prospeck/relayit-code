import { z } from "zod";

/** Persisted body ids stay stable; each now selects an original RelayIt token outline. */
export const MASCOT_BODY_IDS = ["cursor", "blob", "circle", "squircle", "capsule", "drop", "shield", "hexagon", "diamond", "star"] as const;
export type MascotBodyId = (typeof MASCOT_BODY_IDS)[number];
export const mascotBodySchema = z.enum(MASCOT_BODY_IDS);
export const DEFAULT_MASCOT_BODY: MascotBodyId = "cursor";
export interface MascotBody { id: MascotBodyId; name: string; outline: string }
export const MASCOT_BODIES: Record<MascotBodyId, MascotBody> = {
  cursor: { id: "cursor", name: "Relay", outline: "M20 6H44Q58 6 58 20V44Q58 58 44 58H20Q6 58 6 44V20Q6 6 20 6Z" },
  blob: { id: "blob", name: "Handoff", outline: "M18 6H40Q46 6 50 12L58 24V44Q58 58 44 58H24Q18 58 14 52L6 40V20Q6 6 18 6Z" },
  circle: { id: "circle", name: "Orbit", outline: "M32 6A26 26 0 1 1 32 58A26 26 0 1 1 32 6Z" },
  squircle: { id: "squircle", name: "Tile", outline: "M16 6H48Q58 6 58 16V48Q58 58 48 58H16Q6 58 6 48V16Q6 6 16 6Z" },
  capsule: { id: "capsule", name: "Baton", outline: "M24 6H40Q54 6 54 20V44Q54 58 40 58H24Q10 58 10 44V20Q10 6 24 6Z" },
  drop: { id: "drop", name: "Stride", outline: "M20 6H44Q58 6 58 20V38Q58 44 52 48L40 58H20Q6 58 6 44V20Q6 6 20 6Z" },
  shield: { id: "shield", name: "Anchor", outline: "M14 6H50Q56 6 56 12V38Q56 48 32 59Q8 48 8 38V12Q8 6 14 6Z" },
  hexagon: { id: "hexagon", name: "Link", outline: "M20 6H44L59 32L44 58H20L5 32Z" },
  diamond: { id: "diamond", name: "Pivot", outline: "M28 5Q32 1 36 5L59 28Q63 32 59 36L36 59Q32 63 28 59L5 36Q1 32 5 28Z" },
  star: { id: "star", name: "Signal", outline: "M22 5H42L47 17L59 22V42L47 47L42 59H22L17 47L5 42V22L17 17Z" },
};

export function botMascotBody(value: unknown): MascotBodyId {
  return mascotBodySchema.safeParse(value).data ?? DEFAULT_MASCOT_BODY;
}
