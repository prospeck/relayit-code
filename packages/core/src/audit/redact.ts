/**
 * Redaction for anything written to the audit log or sent to the UI as "data".
 * Three layers: sensitive field names, known secret values, and key-shaped strings.
 */
const SENSITIVE_KEY = /(api[_-]?key|secret|token|password|passwd|authorization|cookie|otp|\bpin\b|cvv|card[_-]?number|private[_-]?key|refresh)/i;
const KEY_SHAPES: RegExp[] = [
  /sk-ant-[A-Za-z0-9_-]{10,}/g,
  /sk-(proj-|or-v1-)?[A-Za-z0-9_-]{16,}/g,
  /AIza[0-9A-Za-z_-]{30,}/g,
  /gh[opsu]_[A-Za-z0-9]{20,}/g,
  /rzp_(test|live)_[A-Za-z0-9]{8,}/g,
  /ya29\.[A-Za-z0-9_-]{20,}/g,
  /Bearer\s+[A-Za-z0-9._~+/-]{16,}=*/g,
];

export const REDACTED = "[redacted]";

export class Redactor {
  private known = new Set<string>();

  /** Register a secret value so it is scrubbed wherever it appears. */
  remember(value: string): void {
    if (value && value.length >= 6) this.known.add(value);
  }

  forget(value: string): void {
    this.known.delete(value);
  }

  text(input: string): string {
    let out = input;
    for (const v of this.known) if (out.includes(v)) out = out.split(v).join(REDACTED);
    for (const re of KEY_SHAPES) out = out.replace(re, REDACTED);
    return out;
  }

  value(input: unknown, depth = 0): unknown {
    if (depth > 8) return "[…]";
    if (typeof input === "string") return this.text(input.length > 4000 ? `${input.slice(0, 4000)}…` : input);
    if (Array.isArray(input)) return input.slice(0, 50).map((v) => this.value(v, depth + 1));
    if (input && typeof input === "object") {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(input)) {
        out[k] = SENSITIVE_KEY.test(k) && v != null && v !== "" ? REDACTED : this.value(v, depth + 1);
      }
      return out;
    }
    return input;
  }
}
