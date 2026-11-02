export type UpiRequest = {
  vpa: string;
  payeeName: string;
  amountInr: number;
  note: string;
  txnRef: string;
  merchantCode?: string;
};

export const VPA_PATTERN = /^[a-zA-Z0-9._-]+@[a-zA-Z0-9.-]+$/;

export function amountInPaise(amountInr: number): number {
  if (!Number.isFinite(amountInr) || amountInr <= 0 || amountInr > 100_000) {
    throw new Error("Amount must be greater than 0 and at most ₹1,00,000");
  }
  const paise = Math.round(amountInr * 100);
  if (paise < 1 || Math.abs(amountInr * 100 - paise) > 0.000001) {
    throw new Error("Amount must have at most two decimal places");
  }
  return paise;
}

export function buildUpiUri(input: UpiRequest): string {
  if (!VPA_PATTERN.test(input.vpa)) throw new Error("Invalid UPI VPA (expected name@handle)");
  if (!input.payeeName.trim()) throw new Error("Payee name is required");
  if (!input.txnRef.trim()) throw new Error("Transaction reference is required");
  if (Array.from(input.note).length > 80) throw new Error("Note must be at most 80 characters");
  const paise = amountInPaise(input.amountInr);
  const params: Record<string, string> = {
    pa: input.vpa,
    pn: input.payeeName,
    am: (paise / 100).toFixed(2),
    cu: "INR",
    tn: input.note,
    tr: input.txnRef,
  };
  if (input.merchantCode !== undefined) params.mc = input.merchantCode;
  return `upi://pay?${Object.entries(params)
    .map(([key, value]) => `${key}=${encodeURIComponent(value)}`)
    .join("&")}`;
}

export function parseUpiUri(uri: string): UpiRequest {
  const url = new URL(uri);
  if (url.protocol !== "upi:" || url.hostname !== "pay" || (url.pathname && url.pathname !== "/")) {
    throw new Error("Invalid UPI payment URI");
  }
  const required = (key: string): string => {
    const value = url.searchParams.get(key);
    if (value === null) throw new Error(`Missing UPI parameter: ${key}`);
    return value;
  };
  if (required("cu") !== "INR") throw new Error("Only INR is supported");
  const amount = required("am");
  if (!/^\d+(?:\.\d{1,2})?$/.test(amount)) throw new Error("Invalid UPI amount");
  const input: UpiRequest = {
    vpa: required("pa"),
    payeeName: required("pn"),
    amountInr: Number(amount),
    note: required("tn"),
    txnRef: required("tr"),
  };
  const merchantCode = url.searchParams.get("mc");
  if (merchantCode !== null) input.merchantCode = merchantCode;
  buildUpiUri(input);
  return input;
}
