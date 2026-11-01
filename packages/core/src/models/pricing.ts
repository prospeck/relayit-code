/**
 * Rough USD prices per million tokens [input, output] by model-family pattern.
 * Used only for the "≈ ₹0.42" estimate under replies; unknown models show tokens only.
 */
const TABLE: [RegExp, number, number][] = [
  [/claude.*haiku/i, 1, 5],
  [/claude.*sonnet/i, 3, 15],
  [/claude.*opus/i, 5, 25],
  [/claude.*fable/i, 3, 15],
  [/gpt-.*nano/i, 0.05, 0.4],
  [/gpt-.*mini/i, 0.25, 2],
  [/^gpt-|^o\d/i, 1.25, 10],
  [/gemini.*flash-lite/i, 0.1, 0.4],
  [/gemini.*flash/i, 0.3, 2.5],
  [/gemini.*pro/i, 1.25, 10],
];
export const USD_TO_INR = 88;

export function estimateCostInr(
  provider: string,
  model: string,
  input: number,
  output: number,
): number | null {
  if (provider === "ollama" || provider === "mock") return 0;
  const name = model.includes("/") ? model.split("/").pop()! : model;
  const row = TABLE.find(([re]) => re.test(name));
  if (!row) return null;
  return Math.round(((input * row[1] + output * row[2]) / 1_000_000) * USD_TO_INR * 100) / 100;
}
