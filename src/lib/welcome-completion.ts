const GATE_KEY = "omb-email-gate";
let completed = false;

export function emailGateDone(): boolean {
  try {
    return completed || Boolean(globalThis.localStorage?.getItem(GATE_KEY));
  } catch {
    return completed;
  }
}

export function setEmailGateDone(status: "submitted" | "skipped") {
  completed = true;
  try {
    globalThis.localStorage?.setItem(GATE_KEY, status);
  } catch {
    // Keep this session complete when browser storage is blocked.
  }
}
