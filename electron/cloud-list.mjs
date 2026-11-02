// Saved server color swatches.
export const CLOUD_SWATCH_COLORS = Object.freeze({ blue: "blue", green: "teal", amber: "yellow", rose: "red", violet: "purple", slate: null });
export const CLOUD_SWATCHES = Object.freeze(Object.keys(CLOUD_SWATCH_COLORS));

export const swatchColor = swatch => (Object.hasOwn(CLOUD_SWATCH_COLORS, swatch) ? CLOUD_SWATCH_COLORS[swatch] : null);
