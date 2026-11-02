export function ipcErrorText(cause: unknown): string | null {
  return cause instanceof Error && cause.message ? cause.message.replace(/^Error invoking remote method '[^']*':\s*(?:\w*Error:\s*)?/u, "") : null;
}
