/**
 * Every tool result goes back to the model wrapped as data. Closing tags inside the content are
 * neutralised so outside text can't break out of the wrapper.
 */
export function wrapUntrusted(source: string, content: string): string {
  const safe = content.replace(/<\/?untrusted_data/gi, (m) => m.replace("<", "‹"));
  return `<untrusted_data source="${source.replace(/"/g, "")}">\n${safe}\n</untrusted_data>`;
}

export function stringifyResult(value: unknown, max = 24_000): string {
  const text = typeof value === "string" ? value : JSON.stringify(value, null, 1);
  return text.length > max
    ? `${text.slice(0, max)}\n…[truncated ${text.length - max} chars]`
    : text;
}

/** Pulls `_parts` out of a tool result so they go to the UI, not the model. */
export function extractParts(value: unknown): { value: unknown; parts: unknown[] } {
  if (value && typeof value === "object" && !Array.isArray(value) && "_parts" in value) {
    const { _parts, ...rest } = value as Record<string, unknown>;
    return { value: rest, parts: Array.isArray(_parts) ? _parts : [] };
  }
  return { value, parts: [] };
}
