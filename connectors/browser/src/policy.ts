export type FieldMetadata = {
  type?: string | null;
  name?: string | null;
  id?: string | null;
  autocomplete?: string | null;
  ariaLabel?: string | null;
  placeholder?: string | null;
};

// Also passed into the isolated page script; keep the two detection paths identical.
export const SENSITIVE_PATTERN =
  "password|passcode|otp|one[\\s_-]*time[\\s_-]*code|cc[\\s_-]*(?:number|csc|exp)|card[\\s_-]*(?:number|no|security)|cvv|cvc|pin(?![a-z])|pin(?=code|field|input|number|value|entry|confirm)|upi";

export function isSensitiveField(field: FieldMetadata): boolean {
  return [
    field.type,
    field.name,
    field.id,
    field.autocomplete,
    field.ariaLabel,
    field.placeholder,
  ].some((value) => new RegExp(SENSITIVE_PATTERN, "i").test(value ?? ""));
}

export function validateUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Browser URLs must use http or https");
  }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) {
    throw new Error("Browser URLs must use http or https without embedded credentials");
  }
  return url.href;
}

export function isCommit(target: { text: string; submit: boolean }): boolean {
  return (
    target.submit ||
    /\b(place\s+(?:an?\s+)?order|pay|proceed\s+to\s+pay|check\s*out|confirm|book|buy|send|post|delete|submit|request\s+(?:a\s+)?ride|continue\s+to\s+payment)\b/i.test(
      target.text,
    )
  );
}

export function isPaymentStep(url: string, text: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  const host = parsed.hostname.toLowerCase();
  const paymentHosts = [
    "razorpay.com",
    "payu.in",
    "payu.com",
    "juspay.in",
    "paytm.com",
    "phonepe.com",
  ];
  return (
    paymentHosts.some((domain) => host === domain || host.endsWith(`.${domain}`)) ||
    /(?:^|[/_?=&-])(payment|payments|pay|billing)(?:$|[/_?=&#-])/i.test(
      parsed.pathname + parsed.search,
    ) ||
    /\b(?:cards?|upi|net\s*banking|wallet|cvv|card[\s_-]*(?:number|no)|cc[\s_-]*(?:number|csc))\b/i.test(
      text,
    )
  );
}
