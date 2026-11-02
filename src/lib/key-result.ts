export type KeyResult = "ok" | "rejected" | "unverified" | "error";

export function keyTestResult(answer: { ok?: unknown; reason?: unknown } | null | undefined): KeyResult {
  if (answer?.ok === true) return "ok";
  return answer?.reason === "rejected" ? "rejected" : "unverified";
}
