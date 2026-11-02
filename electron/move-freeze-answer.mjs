export function freezeAnswer(got) {
  if (got.status === 409 && typeof got.body?.busy === "string") return { busy: got.body.busy, ...(typeof got.body.what === "string" ? { what: got.body.what } : {}) };
  if (!got.ok || got.body?.frozen !== true) throw Object.assign(new Error("RelayIt on this computer could not pause."), { status: got.status });
  return { frozen: true };
}
