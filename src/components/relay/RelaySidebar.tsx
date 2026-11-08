// RelayIt's sidebar: one assistant, so no list of bots. Today, a new relay, and every relay newest first, each marked
// by where it stands: coral when it waits on you, a running ring while it works, nothing once it is done.
import type { CSSProperties } from "react";
import { CalendarClock, Plus, Sun } from "lucide-react";

import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { relayStatus, relaysOf, type RelayStatus } from "@/lib/relay";
import { PHONE_LAYOUT, useMediaQuery } from "@/lib/use-media-query";
import { openBotThread } from "@/state/thread-navigation";
import { useStore, type Bot, type Task } from "@/state/store";
import { useDesktopCapabilities, windowFramed } from "../DesktopCapabilities";
import { Wordmark } from "../RelayItMark";
import { SidebarFooter } from "../SidebarFooter";
import { focusRelayComposer } from "./relay-compose";

const ROW = "flex h-9 w-full items-center gap-2.5 rounded-xl px-2.5 text-left text-[14px] transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-focus";

export function RelayMarker({ status }: { status: RelayStatus }) {
  if (status === "yours") return <span aria-hidden="true" data-relay-marker="yours" className="size-2 shrink-0 rounded-full bg-accent" />;
  if (status === "running") {
    return <span aria-hidden="true" data-relay-marker="running"
      className="size-2.5 shrink-0 rounded-full border-[1.5px] border-ink-tertiary border-t-transparent motion-safe:animate-spin" />;
  }
  return <span aria-hidden="true" data-relay-marker="done" className="size-2 shrink-0 rounded-full border border-ink-tertiary/60" />;
}

function statusWords(status: RelayStatus): string {
  return t(status === "yours" ? "relay.status.yours" : status === "running" ? "relay.status.running" : "relay.status.done");
}

export function RelaySidebar({ bot, open, onClose }: { bot: Bot | undefined; open: boolean; onClose: () => void }) {
  const { state, dispatch } = useStore();
  const { capabilities } = useDesktopCapabilities();
  const phone = useMediaQuery(PHONE_LAYOUT, false);
  const framed = windowFramed(capabilities);
  const lights = capabilities.windowChrome === "mac-inset" && !framed;
  const draggable = capabilities.windowChrome !== "native";
  // SAFETY: Electron's -webkit-app-region is not in React's CSSProperties type; the renderer accepts it inline.
  const drag = draggable ? ({ WebkitAppRegion: "drag" } as CSSProperties) : undefined;
  const noDrag = draggable ? ({ WebkitAppRegion: "no-drag" } as CSSProperties) : undefined;
  const relays = relaysOf(bot?.tasks);
  const today = state.activeView === "today";
  const close = () => { if (phone) onClose(); };

  const openRelay = (task: Task) => {
    if (!bot) return;
    openBotThread(dispatch, bot, task.threadId, true);
    close();
  };

  return (
    <aside
      aria-label={t("relay.sidebar.aria")}
      data-sidebar=""
      data-relay-sidebar=""
      className={cn(
        "relative flex h-full w-[264px] shrink-0 flex-col border-r-[0.5px] border-edge bg-panel",
        "max-md:absolute max-md:inset-y-0 max-md:left-0 max-md:z-40 max-md:w-full max-md:bg-app max-md:transition-transform max-md:duration-200",
        open ? "max-md:translate-x-0" : "max-md:-translate-x-full",
      )}
    >
      <div className={cn("flex shrink-0 items-center gap-2 pl-4 pr-2", lights ? "h-[46px] pl-[88px]" : "h-12")} style={drag}>
        <Wordmark height={15} />
        <div className="flex-1" />
        <button type="button" style={noDrag} onClick={() => { dispatch({ type: "showToday" }); focusRelayComposer(); close(); }}
          aria-label={t("relay.sidebar.new")} title={t("relay.sidebar.new")}
          className="flex size-8 items-center justify-center rounded-full text-ink-secondary hover:bg-ink/[0.06] hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-focus">
          <Plus size={18} aria-hidden="true" />
        </button>
      </div>

      <nav aria-label={t("relay.sidebar.places")} className="flex shrink-0 flex-col gap-0.5 px-2 pb-2 pt-1">
        <button type="button" aria-current={today ? "page" : undefined} data-relay-nav="today"
          onClick={() => { dispatch({ type: "showToday" }); close(); }}
          className={cn(ROW, today ? "bg-raised font-medium text-ink" : "text-ink-secondary hover:bg-ink/[0.05] hover:text-ink")}>
          <Sun size={17} aria-hidden="true" className={today ? "text-accent" : undefined} />{t("relay.sidebar.today")}
        </button>
        <button type="button" aria-current={state.activeView === "routines" ? "page" : undefined} data-relay-nav="routines"
          onClick={() => { dispatch({ type: "showRoutines", view: "list" }); close(); }}
          className={cn(ROW, state.activeView === "routines" ? "bg-raised font-medium text-ink" : "text-ink-secondary hover:bg-ink/[0.05] hover:text-ink")}>
          <CalendarClock size={17} aria-hidden="true" />{t("relay.sidebar.routines")}
        </button>
      </nav>

      <div className="flex min-h-0 flex-1 flex-col">
        <h2 className="shrink-0 px-[18px] pb-1.5 pt-3 text-[12px] font-medium text-ink-tertiary">{t("relay.sidebar.relays")}</h2>
        {relays.length === 0 ? (
          <p className="px-[18px] text-[13px] leading-[19px] text-ink-tertiary">{t("relay.sidebar.empty")}</p>
        ) : (
          <ul className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
            {relays.map((task) => {
              const status = relayStatus(task);
              const current = state.activeView === "chat" && state.selectedId === bot?.id && bot?.threadId === task.threadId;
              return (
                <li key={task.threadId}>
                  <button type="button" data-relay-row={status} aria-current={current ? "page" : undefined}
                    onClick={() => openRelay(task)}
                    className={cn(ROW, "h-[34px]", current ? "bg-raised text-ink" : "text-ink-secondary hover:bg-ink/[0.05] hover:text-ink",
                      status === "yours" && !current && "text-ink")}>
                    <span className="flex w-3 shrink-0 justify-center"><RelayMarker status={status} /></span>
                    <span className="min-w-0 flex-1 truncate">{task.title || t("relay.untitled")}</span>
                    <span className="sr-only">, {statusWords(status)}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
      <SidebarFooter density="comfortable" simple owner={null} toolsCollapsed={false} />
    </aside>
  );
}
