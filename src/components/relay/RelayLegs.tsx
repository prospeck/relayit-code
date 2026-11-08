// A relay's legs, as a strip under the chat's header: Find, Prepare, Your OK, Done. The runner (the coral dot from
// the mark) sits on the leg it is on, so a glance says whether RelayIt is still working or waiting on you.
import { Bookmark, BookmarkCheck } from "lucide-react";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { RELAY_LEGS, relayLeg } from "@/lib/relay";
import type { Message } from "@/state/store";
import { isUsual, removeUsual, saveUsual, useUsuals } from "./usuals";

const LABEL = { find: "relay.leg.find", prepare: "relay.leg.prepare", ok: "relay.leg.ok", done: "relay.leg.done" } as const;

export function RelayLegs({ messages, waiting, running }: { messages: readonly Message[]; waiting: boolean; running: boolean }) {
  if (!messages.some((message) => message.role === "user")) return null;
  const leg = relayLeg(messages, { waiting, running });
  const at = RELAY_LEGS.indexOf(leg);
  const asked = [...messages].reverse().find((message) => message.role === "user")?.text?.trim() ?? "";
  return (
    <div data-relay-strip="" className="relative z-10 mx-auto flex w-full items-center justify-center bg-app/90 pb-1.5 backdrop-blur-sm"><div className="flex w-full max-w-[640px] items-center gap-3 px-5">
    <ol aria-label={t("relay.leg.aria")} data-relay-legs={leg} className="flex min-w-0 flex-1 items-center gap-1.5">
      {RELAY_LEGS.map((name, index) => {
        const current = index === at;
        const past = index < at;
        return (
          <li key={name} aria-current={current ? "step" : undefined} className="flex min-w-0 flex-1 flex-col gap-1">
            <span className="relative h-[3px] rounded-full bg-ink/10">
              <span className={cn("absolute inset-y-0 left-0 rounded-full",
                past || (current && name === "done") ? "w-full bg-ink/70" : current ? "w-1/2 bg-ink/70" : "w-0")} />
              {current && name !== "done" && (
                <span aria-hidden="true" className={cn("absolute left-1/2 top-1/2 size-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-accent",
                  running && !waiting && "motion-safe:animate-pulse")} />
              )}
            </span>
            <span className={cn("truncate text-[11px] font-medium",
              current ? name === "ok" ? "text-accent-text" : "text-ink" : past ? "text-ink-secondary" : "text-ink-tertiary")}>
              {t(LABEL[name])}
            </span>
          </li>
        );
      })}
    </ol>
    {leg === "done" && asked && asked.length <= 280 && <SaveUsual text={asked} />}
    </div></div>
  );
}

/** A finished relay can become a usual: one tap on Today next time. */
function SaveUsual({ text }: { text: string }) {
  useUsuals();
  const saved = isUsual(text);
  const Icon = saved ? BookmarkCheck : Bookmark;
  return (
    <button type="button" aria-pressed={saved} data-save-usual=""
      onClick={() => (saved ? removeUsual(text) : saveUsual(text))}
      title={t(saved ? "relay.usual.saved" : "relay.usual.save")}
      className={cn("flex h-7 shrink-0 items-center gap-1.5 rounded-full px-2.5 text-[12px] font-medium transition-colors",
        saved ? "text-accent-text" : "text-ink-secondary hover:bg-ink/[0.06] hover:text-ink")}>
      <Icon size={14} aria-hidden="true" />{t(saved ? "relay.usual.saved" : "relay.usual.save")}
    </button>
  );
}
