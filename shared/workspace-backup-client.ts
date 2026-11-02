// Exact app-owned browser state that belongs in an encrypted full backup.
// Never include cookies, authentication tokens, connection caches or unknown keys.
export const WORKSPACE_BACKUP_CLIENT_KEYS = [
  "omb-drafts",
  "omb-draft-attachments",
  "omb-draft-send-ids",
  "omb-draft-channel-modes",
  "omb-skin",
  "omb-show-threads",
  "omb-show-run-card",
  "omb-send-key",
  "omb-color-user-bubbles",
  "omb-chat-width",
  "relayit.sidebarDensity",
  "relayit.sidebarToolsLayout",
  "relayit.sidebarCollapsedSections.v1",
  "relayit.sidebarSectionOrder.v1",
  "relayit.remote-voice.v1",
] as const;

export type WorkspaceBackupClientState = Partial<Record<(typeof WORKSPACE_BACKUP_CLIENT_KEYS)[number], string>>;
