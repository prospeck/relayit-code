// One person's connected apps on this computer and on their own Cloud. With RelayIt's connected-apps service, this
// computer's installation mints a code for the Cloud's installation, which then acts as the same Composio user. With the
// person's own Composio project, the Cloud saves the same key and user. A Cloud whose own apps are already connected
// keeps them: each app connected here is then connected there once.
import { createHash } from "node:crypto";


import * as composio from "./composio.ts";
import { saveConfig, syncCredentialEnv, type AppConfig } from "./config.ts";

export type ComposioMode = "own";

/** This server's connected-apps account, in digests: two servers reach the same apps exactly when `account` is equal. */
export interface ComposioIdentity {
  mode: ComposioMode;
  account: string;
  /** The managed service's installation, which a code from this computer is minted for. */
  installationId?: string;
  /** This installation acts as a user another installation shared with it. */
  shared: boolean;
  /** The apps connected now, as last read; absent until the first read. */
  apps?: string[];
}


const APPS_TTL_MS = 10 * 60_000;
const ownDigest = (userId: string) => createHash("sha256").update(`omb-composio-own:${userId}`).digest("hex").slice(0, 24);


let apps: { key: string; at: number; slugs: string[] } | null = null;
let appsReading: Promise<void> | null = null;

/** Forgets what the managed service said about this installation, after it adopted a shared user. */
export function forgetComposioIdentity(): void {
  apps = null;
}


/** The apps connected now, read at most every ten minutes and never waited for: the first call starts the read. */
function connectedApps(cfg: AppConfig, key: string): string[] | undefined {
  const fresh = apps && apps.key === key && Date.now() - apps.at < APPS_TTL_MS;
  if (!fresh && !appsReading) {
    appsReading = composio.connectedServices(cfg)
      .then((services) => { apps = { key, at: Date.now(), slugs: Object.entries(services).filter(([, state]) => state.connected).map(([slug]) => slug).sort() }; })
      .catch(() => {})
      .finally(() => { appsReading = null; });
  }
  return apps?.key === key ? apps.slugs : undefined;
}

/** Null when this server has no connected-apps account, or the service is too old to share one. */
export async function composioIdentity(cfg: AppConfig): Promise<ComposioIdentity | null> {
  const mode = composio.connectionMode(cfg);
  if (mode === "self-hosted") {
    const userId = cfg.composio?.userId;
    return userId ? { mode: "own", account: `own:${ownDigest(userId)}`, shared: false, apps: connectedApps(cfg, `own:${userId}`) } : null;
  }
  return null;
}

/** A one-time code for that installation to act as this computer's Composio user. */


export type ShareOutcome = { shared: true } | { kept: true };

/** Adopts the code on this Cloud's installation; a Cloud with connected apps of its own keeps them. */


/** Saves this computer's own Composio project on this Cloud, for the same user, unless this Cloud already reaches
 * connected apps of its own. */
export async function adoptOwnComposio(cfg: AppConfig, apiKey: string, userId: string): Promise<ShareOutcome> {
  const current = cfg.composio;
  if (current?.apiKey?.trim()) return current.apiKey.trim() === apiKey.trim() && current.userId === userId ? { shared: true } : { kept: true };

  const prepared = await composio.prepareProjectSession(apiKey, { userId });
  saveConfig({ composio: prepared });
  syncCredentialEnv({ composio: prepared });
  cfg.composio = prepared;
  forgetComposioIdentity();
  return { shared: true };
}
