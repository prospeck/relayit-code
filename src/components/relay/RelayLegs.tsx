// A relay's legs, as a strip under the chat's header: Find, Prepare, Your OK, Done. The runner (the coral dot from
// the mark) sits on the leg it is on, so a glance says whether RelayIt is still working or waiting on you.
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { RELAY_LEGS, relayLeg } from "@/lib/relay";
import type { Message } from "@/state/store";

const LABEL = { find: "relay.leg.find", prepare: "relay.leg.prepare", ok: "relay.leg.ok", done: "relay.leg.done" } as const;

export function RelayLegs({ messages, waiting, running }: { messages: readonly Message[]; waiting: boolean; running: boolean }) {
  if (!messages.some((message) => message.role === "user")) return null;
  const leg = relayLeg(messages, { waiting, running });
  const at = RELAY_LEGS.indexOf(leg);
  return (
    <ol aria-label={t("relay.leg.aria")} data-relay-legs={leg} className="mx-auto mb-1 flex w-full max-w-[560px] items-center gap-1.5 px-5">
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
  );
}
