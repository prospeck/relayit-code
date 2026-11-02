// Local allow-list checks for paired session identities.


import type { Scope } from "./sessions.ts";

/** Who may sign in. `a@b.com` is that address; `@b.com` is everyone at b.com. */
export interface SignInAllowList {
  admins: string[];
  members: string[];
}

/** Commas, spaces or newlines between entries; case does not matter. */
export function parseAllowList(value: string | undefined | null): string[] {
  return (value ?? "")
    .split(/[,\s]+/)
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
}

export function allowedScopes(rawEmail: string, list: SignInAllowList): Scope[] | null {
  const email = rawEmail.trim().toLowerCase();
  if (!email.includes("@")) return null;
  const matches = (entry: string) => (entry.startsWith("@") ? email.endsWith(entry) && email.length > entry.length : entry === email);
  if (list.admins.some(matches)) return ["admin", "client"];
  if (list.members.some(matches)) return ["client"];
  return null;
}

export function signInEnabled(list: SignInAllowList): boolean {
  return list.admins.length + list.members.length > 0;
}
