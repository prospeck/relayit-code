import type { CloudSwatch } from "../../electron/cloud-list.mjs";
import type { LocaleKey } from "@/locales";
import type { CloudColor } from "./cloud-look";
import { cloudColorFill } from "./cloud-look";

export const SWATCH_COLOR = { blue: "blue", green: "teal", amber: "yellow", rose: "red", violet: "purple", slate: null } as const satisfies Record<CloudSwatch, CloudColor | null>;
export function swatchFill(swatch: CloudSwatch): string {
  const color = SWATCH_COLOR[swatch];
  return color ? cloudColorFill(color) : "var(--color-raised)";
}

/** The Admin's swatches in the order the sheet offers them, each with the name of the colour this app draws it in. */
export const CLOUD_SWATCH_LABEL = {
  blue: "placeLook.color.blue", green: "placeLook.color.teal", amber: "placeLook.color.yellow", rose: "placeLook.color.red", violet: "placeLook.color.purple", slate: "placeLook.color.slate",
} as const satisfies Record<CloudSwatch, LocaleKey>;
export const CLOUD_SWATCH_ORDER = Object.keys(CLOUD_SWATCH_LABEL) as CloudSwatch[];
export const DEFAULT_SWATCH: CloudSwatch = "blue";
