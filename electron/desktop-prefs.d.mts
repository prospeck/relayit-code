export { DESKTOP_PORTS } from "./desktop-ports.mjs";

/** The app's language on this computer, one pick for every page its window shows. */
export interface DesktopLanguageBridge {
  /** A locale code, "" to follow the system, or null until one is picked on this computer. */
  choice(): string | null;
  set(language: string): Promise<boolean>;
  /** A pick made on another page of this desktop. */
  onChange(listener: (language: string) => void): () => void;
}
export interface DesktopPrefs {

  language(): string | null;
  /** False for anything that is not a locale code or "". */
  setLanguage(language: unknown): boolean;

  /** True until switched off. */
  talkShortcut(): boolean;
  setTalkShortcut(enabled: boolean): void;
  talkKey(): import("./talk-shortcut.mjs").TalkKeyId;
  /** False, and nothing saved, for anything but a key id in talk-keys.mjs. */
  setTalkKey(id: unknown): boolean;
  /** The Quick asks chat made on this server (keyed by its data folder), null until one is saved. */
  quickAsksChat(server: string): { botId: string; threadId: string } | null;
  setQuickAsksChat(server: string, chat: { botId: string; threadId: string }): void;
  /** False until the person hides the window's rail of places. */
  railHidden(): boolean;
  setRailHidden(hidden: boolean): void;
  /** True until the person turns the window's frame off. */
  windowFrame(): boolean;
  setWindowFrame(on: boolean): void;
}
/** The window's frame, this desktop's choice, as Settings reads and changes it. */
export interface WindowFrameState {
  on: boolean;
  /** The choice changes this window only when the app starts again (Windows). */
  restart: boolean;
}
type Files = Pick<typeof import("node:fs"), "readFileSync" | "writeFileSync" | "renameSync" | "rmSync">;
export declare function jsonFile(file: string, files?: Files): { read(): unknown; write(value: unknown): void };
export declare function createDesktopPrefs(options: { read(): unknown; write(value: unknown): void }): DesktopPrefs;
export declare function registerDesktopPrefs(options: {
  /** Used instead of making a store from read/write. */
  prefs?: DesktopPrefs;
  ipcMain: { handle(channel: string, handler: (event: unknown, ...args: unknown[]) => unknown): void; on(channel: string, listener: (event: { returnValue?: unknown }) => void): void };
  read(): unknown;
  write(value: unknown): void;
  page(event: unknown): "local" | "cloud" | "server" | null;

  languageChanged?(language: string, sender: unknown): void;
  /** The window's frame: `made()`, the frame the window was made with (null before it is); `restarts`, a change waits for
   * the app to start again; `changed()`, the pages hear it. */
  frame?: { made(): boolean | null; restarts: boolean; changed(): void } | null;
  /** The RelayIt Cloud sign-in client: with it, the product-updates question is asked and its answer kept here. */

}): void;
