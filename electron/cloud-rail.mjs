import environments from "./environments.cjs";
import { placeLook, railPaint } from "./place-look.mjs";

export const RAIL_MIN_PLACES = 2;

export function railPlaces({ saved, home = null, offers = () => false }) {
  const places = saved.environments.filter(entry => !entry.home && !entry.team && !entry.cloud)
    .filter(entry => !home || entry.kind !== "local")
    .map(entry => {
      const local = entry.kind === "local";
      const color = environments.ENTRY_COLORS.includes(entry.color) ? entry.color : null;
      const paint = railPaint(placeLook(entry), color);
      return { id: entry.id, name: entry.name, color, kind: local ? "computer" : "server", opens: true,
        ...(paint ? { paint } : {}), ...(entry.id === saved.activeId ? { active: true } : {}),
        ...(!local ? { removable: true, forget: true } : {}), ...(!local && offers(entry) ? { makeHome: true } : {}) };
    });
  if (!home) {
    const color = environments.ENTRY_COLORS.includes(saved.localColor) ? saved.localColor : null;
    places.unshift({ id: "local", name: "This computer", color, kind: "computer", opens: true, paint: railPaint({ change: "local" }, color), ...(!saved.activeId || saved.activeId === "local" ? { active: true } : {}) });
  }
  return places.length >= RAIL_MIN_PLACES ? places : [];
}

export function installCloudRail({ ipcMain, guard, trusted, lists = trusted, beside = () => false, places, open, add, targets, makeHome = null, forget = null }) {
  let sent = "";
  const listed = (channel, handler) => ipcMain.handle(channel, guard((event, ...args) => {
    if (!lists(event)) throw new Error(`${channel} is only available in this app's window`);
    return handler(event, ...args);
  }));
  const choices = () => ({ cloud: false, organization: false, link: add.choices().link, address: add.choices().address });
  ipcMain.handle("workspaces:places", guard(event => lists(event) ? { places: places(), add: choices() }
    : { places: [], add: { cloud: false, link: false, address: false, organization: false }, ...(beside() ? { beside: true } : {}) }));
  listed("workspaces:open", (_event, id) => {
    const place = places().find(entry => entry.id === id && entry.opens);
    if (!place) throw new Error("That place isn't here any more.");
    return open(place.id);
  });
  listed("workspaces:remove", async (_event, id) => {
    const place = places().find(entry => entry.id === id && entry.removable && entry.forget);
    if (!place) throw new Error("That place isn't here any more.");
    return { outcome: forget ? await forget(place.id) === false ? "failed" : "removed" : "unsupported" };
  });
  listed("workspaces:make-home", (_event, id) => {
    const place = places().find(entry => entry.id === id && entry.makeHome);
    if (!place || !makeHome) throw new Error("That server can't be your bots' home now.");
    return makeHome(place.id);
  });
  listed("workspaces:add", (event, choice, link) => {
    if (!trusted(event) || !["link", "address"].includes(choice) || !choices()[choice]) throw new Error("That way of adding a server isn't available here.");
    return add.run(choice, typeof link === "string" ? link : "");
  });
  return {
    changed() {
      const key = JSON.stringify([places(), choices(), beside()]);
      if (key === sent) return;
      sent = key;
      for (const target of targets()) if (target && !target.isDestroyed()) target.send("workspaces:changed");
    },
  };
}
