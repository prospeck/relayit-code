import { useEffect, useRef, useState } from "react";
import { Archive, ArrowLeftRight, Check, Cloud, FolderOpen, Gauge, Info, Keyboard, Laptop, LifeBuoy, Settings as SettingsIcon, Smartphone, UserRound, UsersRound, Zap } from "lucide-react";

import { InitialsAvatar } from "./Avatar";

import { AboutDialog } from "./AboutDialog";

import { CloudTile } from "./workspace-parts";


import type { WorkspacePlace } from "./DesktopWorkspaceSwitcher";
import { railShown, usePlaces } from "@/lib/places";
import { useAutomationsNeedYou } from "./SidebarFooterNav";

import { SidebarPopoverMenu, type SidebarMenuItem } from "./SidebarPopoverMenu";
import { ShortcutHint } from "./ShortcutHint";
import { useSidebarPhoneStatus } from "./SidebarPhoneButton";
import { api, useStore, type Action } from "@/state/store";


import { cloudColor } from "@/lib/cloud-look";
import { cn } from "@/lib/cn";


import { activeLocale, t } from "@/lib/i18n";


import { profileForSession, readSessionState, type SessionState } from "@/lib/session";
import { connectPhoneEntry, currentPhonePairingTarget, loadPhonePairingAccess, phoneDestinations, phonePairingSettingsAction, type ConnectPhoneEntry, type PhoneDestination, type PhonePairingAccess } from "@/lib/phone-pairing";

export function profileInitials(profile?: { name?: string; email?: string }): string {
  const name = profile?.name?.trim();
  if (name) {
    const words = name.split(/\s+/);
    return words
      .slice(0, 2)
      .map((w) => w[0]!.toUpperCase())
      .join("");
  }
  const email = profile?.email?.trim();
  return email ? email[0]!.toUpperCase() : "?";
}

export function profileLabel(profile?: { name?: string; email?: string }): string {
  return profile?.name?.trim() || profile?.email?.trim() || t("sidebar.profile.you");
}

function useConnectPhoneEntry(cloudHome: boolean): ConnectPhoneEntry | null {
  const target = currentPhonePairingTarget(cloudHome);
  const [access, setAccess] = useState<PhonePairingAccess | null>(null);
  useEffect(() => {
    if (target === "computer") return;
    let alive = true;
    void loadPhonePairingAccess().then((next) => {
      if (alive) setAccess(next);
    });
    return () => {
      alive = false;
    };
  }, [target]);
  return connectPhoneEntry(target, access);
}


export function selectPhoneDestination(_destination: PhoneDestination, { dispatch }: { bridge?: { connectHomeForPhone(): Promise<unknown> }; dispatch: (action: Action) => void }): void {
  dispatch(phonePairingSettingsAction());
}

export function phoneMenuItems({
  destinations,
  connected,
  onConnect,
}: {
  destinations: PhoneDestination[];
  connected: boolean;
  onConnect: (destination: PhoneDestination) => void;
  onGetApp?: () => void;
}): SidebarMenuItem[] {
  return [
    ...destinations.map((destination) => ({
      key: destination.id === "cloud" ? "connect-phone-cloud" : "connect-phone",
      label: t("sidebar.menu.connectPhone"),
      subtitle: destination.team ? t("sidebar.menu.connectPhone.team", { team: destination.team }) : t(destination.subtitleKey),
      ...(destination.noteKey ? { note: t(destination.noteKey) } : {}),
      icon: <Smartphone size={18} />,
      trailing:
        destination.id === "here" && destination.target === "computer" && connected ? (
          <span aria-hidden="true" className="size-1.5 shrink-0 rounded-full bg-success" />
        ) : undefined,
      onSelect: () => onConnect(destination),
    } satisfies SidebarMenuItem)),

  ];
}

export function toolMenuItems({ activeView, automationsNeedYou, onAutomations, onTeamMap, onFiles, archived }: {
  activeView: string;
  automationsNeedYou: boolean;
  onAutomations: () => void;
  onTeamMap: () => void;
  /** set once My Cloud's files are ready to open */
  onFiles?: () => void;
  archived?: ArchivedBots;
}): SidebarMenuItem[] {
  return [
    { key: "automations", label: t("sidebar.nav.automations"), icon: <Zap size={16} />, active: activeView === "routines", attention: automationsNeedYou, onSelect: onAutomations },
    { key: "team-map", label: t("sidebar.nav.teamMap"), icon: <UsersRound size={16} />, active: activeView === "team-map", onSelect: onTeamMap },
    ...(onFiles ? [{ key: "files", label: t("sidebar.nav.files"), icon: <FolderOpen size={16} />, active: activeView === "files", onSelect: onFiles }] : []),
    ...(archived?.count ? [{ key: "archived", label: t("sidebar.archived.title"), icon: <Archive size={16} />, value: String(archived.count), onSelect: archived.open }] : []),
  ];
}

/** The account button's name: the person, then whatever its dot is raised for, then the move to My Cloud while it goes.
 * A failing move and automations that need the person share one segment. */
export function accountLabel(name: string, { automationsNeedYou }: { automationsNeedYou: boolean }): string {
  return [name, automationsNeedYou ? t("sidebar.account.automationsNeedYou") : ""].filter(Boolean).join(" · ");
}

export type AccountDot = "danger" | "accent";
const DOT_COLOR: Record<AccountDot, string> = { danger: "bg-danger", accent: "bg-accent" };

/** The avatar's dot: red while automations, a failed update or the failing move to My Cloud need the person, the accent
 * for an update; none for the move on its way or done (what it brought waits in the menu). */
export function accountDot({ automationsNeedYou }: { automationsNeedYou: boolean }): AccountDot | null {
  return automationsNeedYou ? "danger" : null;
}

/** `besideRail`: the window's rail of places stands beside the page and switches places, so Switch to… isn't offered twice. */
export function placeMenuItems(place: Pick<WorkspacePlace, "bridge" | "current" | "cloudHome" | "onLine" | "openMenu" | "switchable">, { besideRail = false }: {
  owner: string | null;
  /** A team's name on a team's Cloud. */
  name?: string;
  onCloudSettings: () => void;
  besideRail?: boolean;
}): SidebarMenuItem[] {
  const here = <Check size={15} aria-hidden="true" className="shrink-0 text-ink-secondary" />;
  if (!place.switchable) return [];
  const current = place.current;
  const icon = cloudColor(current?.color) ? <CloudTile color={current?.color} size={16} />
    : current?.local === false || (place.cloudHome && !current) ? <Cloud size={16} /> : <Laptop size={16} />;
  return [
    ...(current ? [{ key: "place", label: current.name, ...(place.cloudHome && place.onLine ? { subtitle: place.onLine } : {}), icon, trailing: here, onSelect: place.openMenu }] : []),
    ...(besideRail ? [] : [{ key: "switch-place", label: t("sidebar.menu.switchTo"), icon: <ArrowLeftRight size={16} />, onSelect: place.openMenu }]),
  ];
}


type PlanWindowUse = { available: boolean; usedPercent: number | null; resetsAt: string | null };
export type PlanUsageWindows = { providers: Array<{ ok: boolean; plan: string | null; weekly: PlanWindowUse; fiveHour: PlanWindowUse; extra?: Array<{ label: string; usedPercent: number }> }> };

export interface UsageSummary {
  value: string;
  weekly?: boolean;
  resets?: string;
}

export function resetsIn(at: number | null, now: number): string | undefined {
  if (at === null || !Number.isFinite(at) || at <= now) return undefined;
  const hours = (at - now) / 3_600_000;
  const format = new Intl.RelativeTimeFormat(activeLocale(), { numeric: "auto" });
  return t("sidebar.menu.resets", { when: hours < 24 ? format.format(Math.max(1, Math.round(hours)), "hour") : format.format(Math.round(hours / 24), "day") });
}

export function planUsageSummary(report: PlanUsageWindows | null, now = Date.now()): UsageSummary | null {
  const signedIn = report?.providers.filter((provider) => provider.ok) ?? [];
  for (const window of ["weekly", "fiveHour"] as const) {
    const known = signedIn.map((provider) => provider[window]).filter((entry) => entry.available && entry.usedPercent !== null);
    if (known.length === 0) continue;
    const tightest = known.reduce((most, entry) => (entry.usedPercent! > most.usedPercent! ? entry : most));
    const resets = resetsIn(tightest.resetsAt ? Date.parse(tightest.resetsAt) : null, now);
    return { value: t("sidebar.menu.usageUsed", { percent: Math.round(tightest.usedPercent!) }), weekly: window === "weekly", ...(resets ? { resets } : {}) };
  }
  const budgets = signedIn.flatMap((provider) => provider.extra?.filter((extra) => extra.label === "Monthly spend") ?? []);
  return budgets.length ? { value: t("sidebar.menu.usageUsed", { percent: Math.round(Math.max(...budgets.map((budget) => budget.usedPercent))) }) } : null;
}


function usePlanUsageSummary(enabled: boolean): UsageSummary | null {
  const [summary, setSummary] = useState<UsageSummary | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    void api<PlanUsageWindows>("/api/plan-usage", { background: true })
      .then((report) => { if (alive) setSummary(planUsageSummary(report)); })
      .catch(() => {});
    return () => { alive = false; };
  }, [enabled]);
  return summary;
}

export function profileMenuItems({
  phone,
  usage,
  usageSummary = null,
  simple,
  onUsage,
  onSettings,
  onShortcuts,
  onAbout,
}: {
  phone: SidebarMenuItem[];
  usage: boolean;
  usageSummary?: UsageSummary | null;
  simple?: { tools: SidebarMenuItem[]; places: SidebarMenuItem[] };
  onUsage: () => void;
  onSettings: () => void;
  onShortcuts: () => void;
  onAbout: () => void;
}): SidebarMenuItem[] {
  const help: SidebarMenuItem[] = [
    {
      key: "shortcuts",
      label: t("sidebar.menu.shortcuts"),
      icon: <Keyboard size={18} />,
      ...(simple ? {} : { trailing: <ShortcutHint id="shortcuts-cheat-sheet" /> }),
      onSelect: onShortcuts,
    },
    { key: "about", label: t("sidebar.menu.about"), icon: <Info size={18} />, separatorBefore: true, onSelect: onAbout },
  ];
  const usageItem: SidebarMenuItem | null = usage ? {
    key: "usage",
    label: usageSummary?.weekly ? t("sidebar.menu.weeklyUsage") : t("settings.section.usage"),
    ...(usageSummary ? { value: usageSummary.value } : {}),
    ...(usageSummary?.resets ? { subtitle: usageSummary.resets } : {}),
    ...(simple ? { chevron: true } : {}),
    icon: <Gauge size={18} />,
    onSelect: onUsage,
  } : null;
  const support: SidebarMenuItem = { key: "support", label: t("sidebar.menu.support"), icon: <LifeBuoy size={18} />, submenu: help, onSelect: () => {} };
  const settings: SidebarMenuItem = { key: "settings", label: t("sidebar.menu.settings"), icon: <SettingsIcon size={18} />, onSelect: onSettings };
  const present = (...items: Array<SidebarMenuItem | null | false>) => items.filter((item): item is SidebarMenuItem => Boolean(item));
  if (!simple) return [...present(usageItem), ...phone, support, settings];
  const groups = [
    [...present(usageItem), ...phone, support, settings],
    simple.tools,
    simple.places,
  ].filter((group) => group.length > 0);
  return groups.flatMap((group, at) => group.map((item, index) => (at > 0 && index === 0 ? { ...item, separatorBefore: true } : item)));
}

export interface ArchivedBots {
  count: number;
  open: () => void;
}

export interface SimpleAccount {
  place: WorkspacePlace;
  owner: string | null;
  automationsNeedYou: boolean;
  archived?: ArchivedBots;
}

export function useSimpleAccount(place: WorkspacePlace, owner: string | null, archived?: ArchivedBots): SimpleAccount {
  return { place, owner, automationsNeedYou: useAutomationsNeedYou(), archived };
}

/** `circle` is the phone's round avatar button at the top of the bot list. */
export function SidebarProfileMenu({ iconOnly = false, rail = false, circle = false, simple: account }: {
  iconOnly?: boolean; rail?: boolean; circle?: boolean; simple?: SimpleAccount;
} = {}) {
  const { state, dispatch } = useStore();
  const simple = account !== undefined;
  const [menuOpen, setMenuOpen] = useState(false);

  const engineUsage = usePlanUsageSummary(simple && menuOpen && window.ogb?.remoteClient?.active !== true);
  const phone = useSidebarPhoneStatus();
  const connectPhone = useConnectPhoneEntry(state.config?.cloudHome === true);

  const destinations = phoneDestinations(connectPhone, null);
  const [aboutOpen, setAboutOpen] = useState(false);

  const [session, setSession] = useState<SessionState | null>(null);
  const triggerRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    let active = true;
    void readSessionState().then((state) => {
      if (active) setSession(state);
    });
    return () => { active = false; };
  }, []);

  const profile = profileForSession(state.config?.profile, session);
  const name = profileLabel(profile);
  const connectTo = (destination: PhoneDestination) => selectPhoneDestination(destination, { dispatch });
  const remote = window.ogb?.remoteClient?.active === true;
  const besideRail = railShown(usePlaces());


  const items = profileMenuItems({phone: phoneMenuItems({
        destinations,
        connected: phone.kind === "connected",
        onConnect: connectTo,
      }),
usage: !remote,
usageSummary: engineUsage,
...(account ? { simple: {
      tools: toolMenuItems({
        activeView: state.activeView,
        automationsNeedYou: account.automationsNeedYou,
        onAutomations: () => dispatch({ type: "showRoutines", view: "list" }),
        onTeamMap: () => dispatch({ type: "showTeamMap" }),
        onFiles: (undefined),
        archived: account.archived,
      // RelayIt's own sidebar already has Routines, and its one assistant has no team to map.
      }).filter((item) => remote || (item.key !== "automations" && item.key !== "team-map")),
      places: placeMenuItems(account.place, { owner: account.owner, name: state.config?.team?.name, besideRail, onCloudSettings: () => {} }),
    } } : {}),
onUsage: () => dispatch({ type: "toggleAppSettings", open: true, section: "usage" }),
onSettings: () => dispatch({ type: "toggleAppSettings" }),
onShortcuts: () => {
      triggerRef.current?.closest("button")?.focus();
      dispatch({ type: "toggleShortcuts", open: true });
    },
onAbout: () => setAboutOpen(true)});
  const needsYou = account?.automationsNeedYou === true;
  const initials = profileInitials(profile);
  const nameless = simple && initials === "?" ? <UserRound size={18} strokeWidth={1.75} aria-hidden /> : undefined;
  const label = accountLabel(name, { automationsNeedYou: needsYou });
  const dot = accountDot({ automationsNeedYou: needsYou });
  // Advanced's full row has its own update badge: its avatar's dot is the move's alone.
  const moveDot = accountDot({ automationsNeedYou: false });

  return (
    <>
      <SidebarPopoverMenu
        items={items}
        ariaLabel={name}
        onOpenChange={simple ? setMenuOpen : undefined}
        triggerClassName={iconOnly || simple ? cn("shrink-0", circle || simple ? "rounded-full" : "rounded-xl") : "w-full"}
        triggerTitle={iconOnly || simple ? label : undefined}
        triggerLabel={label}
        triggerTour={account?.place.switchable ? "server-switcher" : undefined}
        renderTrigger={({ open }) => simple ? (
          <span
            ref={triggerRef}
            data-sidebar-account=""
            className={cn("relative flex size-9 items-center justify-center rounded-full ring-2 transition-shadow", open ? "ring-ink/15" : "ring-transparent hover:ring-ink/10")}
          >
            <InitialsAvatar initials={initials} avatarUrl={profile?.avatarUrl} size={36} fallback={nameless} fontSize={14} className="ring-1 ring-inset ring-ink/[0.04]" />
            {dot && <span aria-hidden data-account-dot={dot} className={cn("absolute -right-0.5 -top-0.5 size-2.5 rounded-full ring-2 ring-panel", DOT_COLOR[dot])} />}
          </span>
        ) : iconOnly ? (
          <span
            ref={triggerRef}
            className={cn(
              "relative flex items-center justify-center rounded-xl transition-colors",
              rail ? "size-10" : "size-[46px]",
              circle && "size-10 rounded-full border border-hairline bg-card",
              open ? "bg-raised" : "hover:bg-raised/50",
            )}
          >
            <InitialsAvatar initials={initials} avatarUrl={profile?.avatarUrl} size={rail ? 30 : circle ? 26 : 28} />
            {dot && <span aria-hidden data-account-dot={dot} className={cn("absolute end-1 top-1 size-2.5 rounded-full ring-2 ring-app", DOT_COLOR[dot])} />}
          </span>
        ) : (
          <span
            ref={triggerRef}
            className={cn(
              "flex min-h-[46px] w-full items-center gap-3 rounded-xl px-3 py-2 text-left transition-colors",
              open ? "bg-raised" : "hover:bg-raised/50",
            )}
          >
            <span className="relative flex shrink-0">
              <InitialsAvatar initials={profileInitials(profile)} avatarUrl={profile?.avatarUrl} size={28} />
              {moveDot && <span aria-hidden data-account-dot={moveDot} className={cn("absolute -right-0.5 -top-0.5 size-2 rounded-full ring-2 ring-app", DOT_COLOR[moveDot])} />}
            </span>
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="truncate text-[14px] font-medium leading-5 text-ink">{name}</span>

            </span>

          </span>
        )}
      />
      <AboutDialog open={aboutOpen} onClose={() => setAboutOpen(false)} />

    </>
  );
}
