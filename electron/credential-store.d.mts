export interface CredentialMaster { key: string; protection: "os-keychain" | "key-file" }
export class CredentialStorageError extends Error {}
export const CREDENTIAL_DIRECTORY: string;
export function fallbackMasterKey(dataDir: string): CredentialMaster;
export function credentialProtection(protection: CredentialMaster["protection"]): { protection: CredentialMaster["protection"]; label: string; detail: string };
export function desktopMasterKey(dataDir: string, safe: { available(): Promise<boolean>; encrypt(value: string): Promise<Buffer>; decrypt(value: Buffer): Promise<string> }): Promise<CredentialMaster>;
export class EncryptedCredentialStore {
  constructor(dataDir: string, master?: () => CredentialMaster);
  path(name: string): string;
  read(name: string): unknown;
  write(name: string, value: unknown): void;
  migrate(name: string, load: () => unknown, cleanup: () => void): unknown;
}
