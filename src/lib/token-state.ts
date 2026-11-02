export type TokenState =
  | "sleeping"
  | "waking"
  | "idle"
  | "listening"
  | "thinking"
  | "searching"
  | "working"
  | "excited"
  | "surprised"
  | "suspicious"
  | "angry"
  | "drowsy"
  | "happy"
  | "curious"
  | "confused"
  | "bored"
  | "proud"
  | "shy"
  | "sad"
  | "laughing"
  | "scared"
  | "playful"
  | "celebrate"
  | "orbit"
  | "radar"
  | "progress"
  | "spawning"
  | "humming"
  | "loading"
  | "dictating"
  | "sending"
  | "receiving"
  | "uploading"
  | "writing"
  | "notifying"
  | "alerting"
  | "bouncing"
  | "dragging"
  | "powering-down"

export type TokenActivity = "idle" | "working" | "waiting" | "attention" | "complete";

export function tokenActivity(state: TokenState): TokenActivity {
  if (["alerting", "angry", "scared", "sad", "confused", "surprised"].includes(state)) return "attention";
  if (["listening", "curious", "thinking", "suspicious"].includes(state)) return "waiting";
  if (["happy", "proud", "celebrate", "excited", "laughing", "playful", "notifying"].includes(state)) return "complete";
  if (["working", "searching", "orbit", "radar", "progress", "loading", "dictating", "writing", "sending", "receiving", "uploading", "dragging", "spawning", "waking", "humming", "bouncing"].includes(state)) return "working";
  return "idle";
}
