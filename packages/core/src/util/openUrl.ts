import { spawn } from "node:child_process";

/** Opens an http(s) URL in the user's default browser without going through a shell. */
export function openUrl(url: string): void {
  const u = new URL(url);
  if (u.protocol !== "https:" && u.protocol !== "http:") throw new Error("Only web links can be opened");
  const href = u.toString();
  const [cmd, args] =
    process.platform === "darwin"
      ? ["open", [href]]
      : process.platform === "win32"
        ? ["rundll32", ["url.dll,FileProtocolHandler", href]]
        : ["xdg-open", [href]];
  spawn(cmd, args, { stdio: "ignore", detached: true, windowsHide: true }).unref();
}
