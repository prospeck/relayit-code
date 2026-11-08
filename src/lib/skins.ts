import { hasPriorRun } from "./prior-run";

// RelayIt has one look, Lane, in a day and a night version. The ids are the upstream ones so a stored choice and
// the structural rules keyed on them keep working.
export const SKIN_IDS = ["daylight", "midnight"] as const;
export type SkinId = (typeof SKIN_IDS)[number];

export type Skin = {
  id: SkinId;
  name: string;
  tagline: string;
};

export const SKINS: readonly Skin[] = [
  { id: "daylight", name: "Day", tagline: "White page, black ink, coral when something needs you." },
  { id: "midnight", name: "Night", tagline: "A floodlit field after dark. Easy on the eyes." },
];

/** "system" follows the OS between the light and dark skins below; anything else pins one skin. */
export type SkinChoice = SkinId | "system";
export const THEME_SKINS = { light: "daylight", dark: "midnight" } as const satisfies Record<"light" | "dark", SkinId>;

export const DEFAULT_SKIN_CHOICE: SkinChoice = "system";
export const PRIOR_INSTALL_SKIN: SkinId = "midnight";

const KEY = "omb-skin";
const DARK_QUERY = "(prefers-color-scheme: dark)";

function isSkinId(value: unknown): value is SkinId {
  return SKIN_IDS.includes(value as SkinId);
}

function isSkinChoice(value: unknown): value is SkinChoice {
  return value === "system" || isSkinId(value);
}

function systemPrefersDark(): boolean {
  try {
    return typeof matchMedia === "function" && matchMedia(DARK_QUERY).matches;
  } catch {
    return true;
  }
}

export function resolveSkin(choice: SkinChoice, prefersDark = systemPrefersDark()): SkinId {
  if (choice !== "system") return choice;
  return prefersDark ? THEME_SKINS.dark : THEME_SKINS.light;
}

// With storage blocked the localStorage getter itself throws, and `typeof` alone doesn't shield it.
function getStore(): Storage | undefined {
  try {
    return typeof localStorage === "undefined" ? undefined : localStorage;
  } catch {
    return undefined;
  }
}

export function readSkinChoice(): SkinChoice {
  try {
    const store = getStore();
    const stored = store?.getItem(KEY);
    if (isSkinChoice(stored)) return stored;
    return hasPriorRun(store) ? PRIOR_INSTALL_SKIN : DEFAULT_SKIN_CHOICE;
  } catch {
    return PRIOR_INSTALL_SKIN;
  }
}

export function readSkin(): SkinId {
  return resolveSkin(readSkinChoice());
}

let followingSystem: { query: MediaQueryList; onChange: () => void } | null = null;
const listeners = new Set<() => void>();

export function subscribeSkin(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function paintSkin(id: SkinId): void {
  document.documentElement.dataset.skin = id;
  for (const listener of listeners) listener();
  // On Windows the caption buttons sit in a native overlay the main process paints, out of CSS's reach.
  try {
    void window.ogb?.applySkin?.(id)?.catch(() => undefined);
  } catch {
  }
}

function followSystem(follow: boolean): void {
  if (followingSystem && !follow) {
    followingSystem.query.removeEventListener("change", followingSystem.onChange);
    followingSystem = null;
  }
  if (!follow || followingSystem || typeof matchMedia !== "function") return;
  try {
    const query = matchMedia(DARK_QUERY);
    const onChange = () => paintSkin(resolveSkin("system", query.matches));
    query.addEventListener("change", onChange);
    followingSystem = { query, onChange };
  } catch {
  }
}

/** Wears a skin another page chose, without keeping it as this page's own choice or telling the app (the window's rail
 * wearing the skin of the page beside it). */
export function wearSkin(value: unknown): void {
  if (!isSkinId(value)) return;
  document.documentElement.dataset.skin = value;
  for (const listener of listeners) listener();
}

export function applySkinChoice(choice: SkinChoice): void {
  try {
    getStore()?.setItem(KEY, choice);
  } catch {
  }
  followSystem(choice === "system");
  paintSkin(resolveSkin(choice));
}

export function applySkin(id: SkinId): void {
  applySkinChoice(id);
}
