export type CloudSwatch = "blue" | "green" | "amber" | "rose" | "violet" | "slate";
export declare const CLOUD_SWATCH_COLORS: Readonly<Record<CloudSwatch, string | null>>;
export declare const CLOUD_SWATCHES: readonly CloudSwatch[];
export declare function swatchColor(swatch: unknown): string | null;
