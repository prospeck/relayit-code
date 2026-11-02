import { JEV_DEFAULT_BASE_URL } from "./decider/jev.ts";

export const BOAT_API_DEFAULT = "https://boat.dev/api/v1";
export const ELEVENLABS_API_DEFAULT = "https://api.elevenlabs.io/v1";

export interface ServiceCredential {
  token: string;
  api: string;

}

function credential(own: string | undefined, api: string): ServiceCredential | null {
  const token = own?.trim();
  return token ? { token, api,  } : null;
}

export const boatProviderApi = (env: NodeJS.ProcessEnv = process.env): string => env.OMB_BOAT_API || BOAT_API_DEFAULT;
export const elevenLabsProviderApi = (env: NodeJS.ProcessEnv = process.env): string => env.OMB_ELEVENLABS_API || ELEVENLABS_API_DEFAULT;

export function boatCredential(own: string | undefined, env: NodeJS.ProcessEnv = process.env): ServiceCredential | null {
  return credential(own, boatProviderApi(env));
}

export function voiceCredential(own: string | undefined, env: NodeJS.ProcessEnv = process.env): ServiceCredential | null {
  return credential(own, elevenLabsProviderApi(env));
}

export function deciderCredential(own: string | undefined, baseUrl: string | undefined): ServiceCredential | null {
  return credential(own, baseUrl?.trim() || JEV_DEFAULT_BASE_URL);
}

const LOOPBACK = new Set(["127.0.0.1", "localhost", "[::1]"]);

export const TREG_API_DEFAULT = "https://treg.to";
/** Security: the person's treg key goes only to treg (https), or to a loopback stand-in in development and tests. */
export function tregProviderApi(env: NodeJS.ProcessEnv = process.env): string {
  const configured = env.OMB_TREG_URL?.trim().replace(/\/+$/, "");
  if (!configured) return TREG_API_DEFAULT;
  try {
    const parsed = new URL(configured);
    return parsed.protocol === "https:" || (parsed.protocol === "http:" && LOOPBACK.has(parsed.hostname)) ? configured : TREG_API_DEFAULT;
  } catch {
    return TREG_API_DEFAULT;
  }
}


export function researchCredential(own: string | undefined, env: NodeJS.ProcessEnv = process.env): ServiceCredential | null {
  return credential(own, tregProviderApi(env));
}
