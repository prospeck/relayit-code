/** Folder routing remains metadata so backup workers can reject credential homes inside portable workspace files. */
export const PROVIDER_AUTH_FOLDER_ENV = [
  "HOME", "USERPROFILE", "CLAUDE_CONFIG_DIR", "CODEX_HOME", "GROK_HOME", "KIMI_CODE_HOME", "HERMES_HOME",
  "FACTORY_HOME_OVERRIDE", "XDG_CONFIG_HOME", "XDG_DATA_HOME", "LOCALAPPDATA",
] as const;
