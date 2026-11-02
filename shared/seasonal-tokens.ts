/** Legacy seasonal ids select geometric token details, without character artwork. */
export const HALLOWEEN_BODY_IDS = ["pumpkin", "ghost", "witch", "bat", "cat", "skull", "monster", "mummy", "vampire", "spider"] as const;
export type HalloweenBodyId = (typeof HALLOWEEN_BODY_IDS)[number];
export const HALLOWEEN_BODIES = {
  pumpkin: { name: "Ember" },
  ghost: { name: "Mist" },
  witch: { name: "Arc" },
  bat: { name: "Wing" },
  cat: { name: "Peak" },
  skull: { name: "Frame" },
  monster: { name: "Block" },
  mummy: { name: "Band" },
  vampire: { name: "Edge" },
  spider: { name: "Spoke" },
} satisfies Record<HalloweenBodyId, { name: string }>;
