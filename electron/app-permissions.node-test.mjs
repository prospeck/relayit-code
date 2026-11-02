import assert from "node:assert/strict";
import test from "node:test";

import { readFileSync } from "node:fs";
import { appPermissionAllowed, appPermissionHandlers, emailDraftUrl, externalLinkUrl, externalWebUrl } from "./app-permissions.mjs";




const LOCAL_ORIGIN = "http://127.0.0.1:5199";
const LOCAL_PAGE = "http://127.0.0.1:5199/chat?botId=bot-1";

test("grants notifications, clipboard, and fullscreen to the local renderer page", () => {
  for (const permission of ["notifications", "clipboard-read", "clipboard-sanitized-write", "fullscreen"]) {
    assert.equal(appPermissionAllowed(permission, LOCAL_PAGE, LOCAL_ORIGIN), true, permission);
  }
});

test("accepts a bare origin or a full URL on either side", () => {
  assert.equal(appPermissionAllowed("notifications", LOCAL_ORIGIN, LOCAL_ORIGIN), true);
  assert.equal(appPermissionAllowed("notifications", `${LOCAL_ORIGIN}/settings#voice`, `${LOCAL_ORIGIN}/`), true);
  assert.equal(appPermissionAllowed("fullscreen", "http://127.0.0.1:8799/chat", "http://127.0.0.1:8799"), true);
});

test("allows media for audio (microphone) and guarded display-capture, denies video (camera)", () => {
  assert.equal(appPermissionAllowed("media", LOCAL_PAGE, LOCAL_ORIGIN, { mediaTypes: ["audio"] }), true);
  assert.equal(appPermissionAllowed("media", LOCAL_PAGE, LOCAL_ORIGIN, { mediaType: "audio" }), true);

  // Electron 43 routes getDisplayMedia through permission="media" with an empty mediaTypes array.
  assert.equal(appPermissionAllowed("media", LOCAL_PAGE, LOCAL_ORIGIN, { mediaTypes: [] }), true);

  assert.equal(appPermissionAllowed("media", LOCAL_PAGE, LOCAL_ORIGIN, { mediaTypes: ["video"] }), false);
  assert.equal(appPermissionAllowed("media", LOCAL_PAGE, LOCAL_ORIGIN, { mediaTypes: ["audio", "video"] }), false);
  assert.equal(appPermissionAllowed("media", LOCAL_PAGE, LOCAL_ORIGIN, { mediaType: "video" }), false);

  assert.equal(appPermissionAllowed("media", LOCAL_PAGE, LOCAL_ORIGIN, { mediaType: "unknown" }), false);
  assert.equal(appPermissionAllowed("media", LOCAL_PAGE, LOCAL_ORIGIN, {}), false);
  assert.equal(appPermissionAllowed("media", LOCAL_PAGE, LOCAL_ORIGIN), false);
});

test("refuses permissions to any other origin", () => {
  assert.equal(appPermissionAllowed("notifications", "https://other.example/chat", LOCAL_ORIGIN), false);
  assert.equal(appPermissionAllowed("clipboard-read", "http://127.0.0.1:5200/", LOCAL_ORIGIN), false);
  assert.equal(appPermissionAllowed("media", "https://127.0.0.1:5199/", LOCAL_ORIGIN), false);
  assert.equal(appPermissionAllowed("fullscreen", "http://localhost:5199/", LOCAL_ORIGIN), false);
});

test("keeps every privileged capability off even for the local renderer page", () => {
  const privileged = [
    "geolocation", "camera", "usb", "hid", "serial", "midi", "midiSysex",
    "display-capture", "fileSystem", "openExternal", "idle-detection", "speaker-selection",
    "window-management", "storage-access", "top-level-storage-access", "pointerLock",
    "keyboardLock", "mediaKeySystem", "unknown",
  ];
  for (const permission of privileged) {
    assert.equal(appPermissionAllowed(permission, LOCAL_PAGE, LOCAL_ORIGIN), false, permission);
  }
  assert.equal(appPermissionAllowed(undefined, LOCAL_PAGE, LOCAL_ORIGIN), false);
});

test("rejects mixed, unknown, and conflicting media details", () => {
  for (const details of [
    { mediaTypes: ["audio", "unknown"] }, { mediaTypes: ["unknown"] },
    { mediaType: "audio", mediaTypes: ["video"] },
    { mediaType: "unknown", mediaTypes: [] }, { mediaTypes: "audio" }, null,
  ]) assert.equal(appPermissionAllowed("media", LOCAL_PAGE, LOCAL_ORIGIN, details), false);
});

test("web links reject embedded credentials and non-web schemes", () => {
  assert.equal(externalWebUrl("https://example.com/help?q=hello#more"), "https://example.com/help?q=hello#more");
  assert.equal(externalWebUrl("http://127.0.0.1:8799"), "http://127.0.0.1:8799/");
  for (const url of ["https://user:pass@example.com", "http://user@example.com", "https://:pass@example.com"])
    assert.throws(() => externalWebUrl(url), /credentials/);
  for (const url of ["file:///tmp/test", "javascript:alert(1)", "data:text/html,test", "mailto:test@example.com"])
    assert.throws(() => externalWebUrl(url), /Only web/);
  for (const url of [null, 123, "not a url"])
    assert.throws(() => externalWebUrl(url), /web address/);
});

test("an email link opens only as a draft to one address with a subject and a body", () => {
  const draft = "mailto:support@example.com?subject=Hello%20there&body=Line%20one%0D%0ALine%20two";
  assert.equal(emailDraftUrl(draft), draft);
  assert.equal(externalLinkUrl(draft), draft);
  assert.equal(externalLinkUrl("MAILTO:support@example.com?Subject=Hi"), "mailto:support@example.com?Subject=Hi");
  assert.equal(externalLinkUrl("https://example.com/help"), "https://example.com/help");
  for (const url of ["mailto:a@example.com,b@example.com", "mailto:a%2Cb@example.com", "mailto:?to=a@example.com", "mailto:", "mailto:nobody"])
    assert.throws(() => externalLinkUrl(url), /one address/, url);
  for (const url of ["mailto:a@example.com?attach=/etc/passwd", "mailto:a@example.com?subject=Hi&cc=b@example.com", "mailto:a@example.com?bcc=b@example.com",
    "mailto:a@example.com?to=b@example.com", "mailto:a@example.com?Attachment=~/.ssh/id_rsa"])
    assert.throws(() => externalLinkUrl(url), /only a subject and a body/, url);
  assert.throws(() => emailDraftUrl("mailto:a%E0%A4%A@example.com"), /invalid/);
  assert.throws(() => emailDraftUrl("https://example.com"), /Only email links/);
  for (const url of ["file:///tmp/test", "javascript:alert(1)", "data:text/html,test", "tel:+15555550100", "sms:+15555550100"])
    assert.throws(() => externalLinkUrl(url), /Only web/, url);
  for (const url of [null, 123, "not a url"])
    assert.throws(() => externalLinkUrl(url), /web address/);
});



test("both external-link entry points use the policy and IPC retains the local-origin gate", () => {
  const main = readFileSync(new URL("./main.mjs", import.meta.url), "utf8");
  assert.match(main, /ipcMain\.handle\("desktop:open-external", localOnly\("desktop:open-external"/);
  assert.match(main, /shell\.openExternal\(externalLinkUrl\(rawUrl\)\)/);
  assert.match(main, /shell\.openExternal\(externalLinkUrl\(url\)\)/);
  assert.doesNotMatch(main, /shell\.openExternal\(externalWebUrl\(/);
});

test("fails closed on unparsable or opaque origins", () => {
  assert.equal(appPermissionAllowed("notifications", "not a url", LOCAL_ORIGIN), false);
  assert.equal(appPermissionAllowed("notifications", "", LOCAL_ORIGIN), false);
  assert.equal(appPermissionAllowed("notifications", undefined, LOCAL_ORIGIN), false);
  assert.equal(appPermissionAllowed("notifications", null, LOCAL_ORIGIN), false);
  assert.equal(appPermissionAllowed("notifications", LOCAL_PAGE, "not a url"), false);
  assert.equal(appPermissionAllowed("notifications", LOCAL_PAGE, undefined), false);
  // Opaque origins all serialise as "null"; two of them must never match.
  assert.equal(appPermissionAllowed("notifications", "data:text/html,x", "about:blank"), false);
  assert.equal(appPermissionAllowed("notifications", "javascript:alert(1)", LOCAL_ORIGIN), false);
});

const CLOUD = "https://omb-u-0123456789ab.server.example.test";
function cloudFixture({ home = CLOUD } = {}) {
  const main = { getURL: () => `${CLOUD}/chat?botId=bot-1` };
  const state = { home, main, remote: false };
  const handlers = appPermissionHandlers({
    rendererOrigin: () => LOCAL_ORIGIN,
    mainContents: () => state.main,
    cloudHomeOrigin: () => state.home,
  });
  const ask = (permission, details, contents = state.main) => {
    let granted;
    handlers.request(contents, permission, (value) => { granted = value; }, details);
    return granted;
  };
  const check = (permission, requestingOrigin, details, contents = state.main) => handlers.check(contents, permission, requestingOrigin, details);
  return { state, ask, check };
}
const onCloud = (fields = {}) => ({ requestingUrl: `${CLOUD}/chat?botId=bot-1`, isMainFrame: true, ...fields });

test("the verified Cloud open in this window may use the microphone", () => {
  const { ask, check } = cloudFixture();
  assert.equal(ask("media", onCloud({ mediaTypes: ["audio"] })), true);
  assert.equal(check("media", CLOUD, { requestingUrl: `${CLOUD}/`, isMainFrame: true, mediaType: "audio" }), true);
});

test("the Cloud never gets the camera, screen capture or any other capability but clipboard writes", () => {
  const { ask, check } = cloudFixture();
  for (const mediaTypes of [["video"], ["audio", "video"], [], ["unknown"]]) {
    assert.equal(ask("media", onCloud({ mediaTypes })), false, JSON.stringify(mediaTypes));
  }
  assert.equal(ask("media", onCloud()), false, "media with no type");
  assert.equal(check("media", CLOUD, { isMainFrame: true, mediaType: "video" }), false);
  assert.equal(check("media", CLOUD, { isMainFrame: true, mediaType: "unknown" }), false);
  for (const permission of ["notifications", "clipboard-read", "fullscreen", "geolocation", "display-capture", "camera"]) {
    assert.equal(ask(permission, onCloud()), false, permission);
    assert.equal(check(permission, CLOUD, { isMainFrame: true }), false, permission);
    assert.equal(ask(permission, onCloud({ mediaTypes: ["audio"] })), false, `${permission} with audio details`);
    assert.equal(check(permission, CLOUD, { isMainFrame: true, mediaType: "audio" }), false, `${permission} with audio details`);
  }
});

test("the Cloud's microphone is decided by this computer's media rule, never a copy of it", () => {
  const { ask } = cloudFixture();
  const shapes = [
    {}, { mediaType: "audio" }, { mediaType: "video" }, { mediaTypes: ["audio"] }, { mediaTypes: ["audio", "audio"] },
    { mediaTypes: ["video"] }, { mediaTypes: ["audio", "video"] }, { mediaTypes: ["audio"], mediaType: "video" },
    { mediaTypes: null }, { mediaTypes: "audio" }, { mediaTypes: [""] },
  ];
  for (const shape of shapes) {
    assert.equal(ask("media", onCloud(shape)), appPermissionAllowed("media", CLOUD, CLOUD, shape), JSON.stringify(shape));
  }
});

test("a server that is not the verified Cloud never hears the microphone", () => {
  const { state, ask, check } = cloudFixture();
  const mic = { isMainFrame: true, mediaTypes: ["audio"] };
  for (const other of ["https://my-vps.example.com", "http://omb-u-0123456789ab.server.example.test", "https://omb-u-0123456789ab.server.example.test:8443", "https://evil.fly.dev"]) {
    assert.equal(ask("media", { ...mic, requestingUrl: `${other}/chat` }), false, other);
    assert.equal(check("media", other, { isMainFrame: true, mediaType: "audio" }), false, other);
  }
  assert.equal(ask("media", onCloud({ mediaTypes: ["audio"], isMainFrame: false })), false, "a subframe");
  assert.equal(ask("media", onCloud({ mediaTypes: ["audio"] }), { getURL: () => `${CLOUD}/` }), false, "another window");
  assert.equal(check("media", CLOUD, { isMainFrame: true, mediaType: "audio" }, null), false, "no window");
  state.main = null;
  assert.equal(ask("media", onCloud({ mediaTypes: ["audio"] })), false, "the main window is gone");
});

test("signed out of Cloud, or the Cloud not running, its page loses the microphone at once", () => {
  const { state, ask } = cloudFixture();
  assert.equal(ask("media", onCloud({ mediaTypes: ["audio"] })), true);
  state.home = null;
  assert.equal(ask("media", onCloud({ mediaTypes: ["audio"] })), false);
  state.home = "not a url";
  assert.equal(ask("media", onCloud({ mediaTypes: ["audio"] })), false);
});

test("the verified Cloud open in this window may write the clipboard, by the remote server's rule", () => {
  const write = "clipboard-sanitized-write";
  const { state, ask, check } = cloudFixture();
  assert.equal(ask(write, onCloud()), true);
  assert.equal(check(write, CLOUD, { requestingUrl: `${CLOUD}/`, isMainFrame: true }), true);
  assert.equal(ask("clipboard-read", onCloud()), false);
  assert.equal(check("clipboard-read", CLOUD, { isMainFrame: true }), false);
  assert.equal(ask(write, onCloud({ isMainFrame: false })), false, "a subframe");
  assert.equal(check(write, CLOUD, { isMainFrame: false }), false, "a subframe");
  assert.equal(check(write, CLOUD, {}), false, "no frame information");
  for (const other of ["https://my-vps.example.com", "http://omb-u-0123456789ab.server.example.test", "https://omb-u-0123456789ab.server.example.test:8443", "https://evil.fly.dev"]) {
    assert.equal(ask(write, { requestingUrl: `${other}/chat`, isMainFrame: true }), false, other);
    assert.equal(check(write, other, { isMainFrame: true }), false, other);
  }
  assert.equal(ask(write, onCloud(), { getURL: () => `${CLOUD}/` }), false, "another window");
  assert.equal(check(write, CLOUD, { isMainFrame: true }, null), false, "no window");
  for (const home of [null, "not a url", "about:blank"]) {
    state.home = home;
    assert.equal(ask(write, onCloud()), false, String(home));
    assert.equal(check(write, CLOUD, { isMainFrame: true }), false, String(home));
  }
  state.home = CLOUD;
  state.main = null;
  assert.equal(ask(write, onCloud(), { getURL: () => `${CLOUD}/` }), false, "the main window is gone");
});

test("once My Cloud is home its page may show notifications, in the main window's main frame only; any other page still may not", () => {
  const state = { home: null, main: { getURL: () => `${CLOUD}/chat` } };
  const handlers = appPermissionHandlers({ rendererOrigin: () => LOCAL_ORIGIN, mainContents: () => state.main, cloudHomeOrigin: () => CLOUD, homeOrigin: () => state.home });
  const ask = (details, contents = state.main) => { let granted; handlers.request(contents, "notifications", (value) => { granted = value; }, details); return granted; };
  const check = (origin, details, contents = state.main) => handlers.check(contents, "notifications", origin, details);
  assert.equal(ask(onCloud()), false, "a Cloud the move hasn't reached is not home");
  state.home = CLOUD;
  assert.equal(ask(onCloud()), true);
  assert.equal(check(CLOUD, { isMainFrame: true }), true);
  assert.equal(ask(onCloud({ isMainFrame: false })), false, "a frame inside it");
  assert.equal(check(CLOUD, {}), false, "a frame it cannot vouch for");
  assert.equal(ask(onCloud(), { getURL: () => `${CLOUD}/` }), false, "another window");
  assert.equal(ask({ requestingUrl: "https://bots.example.test/", isMainFrame: true }), false, "another server");
  for (const permission of ["geolocation", "camera", "clipboard-read", "fullscreen"]) {
    let granted; handlers.request(state.main, permission, (value) => { granted = value; }, onCloud());
    assert.equal(granted, false, permission);
  }
  state.home = null;
  assert.equal(ask(onCloud()), false, "signed out or ended: at once");
  for (const requesting of ["about:blank", "data:text/html,x", ""]) assert.equal(ask({ requestingUrl: requesting, isMainFrame: true }), false, `${requesting || "(empty)"}: no home is never a match for an opaque origin`);
});

test("this computer's own page keeps its permissions through the same handlers", () => {
  const { ask, check } = cloudFixture({ home: null });
  const local = { getURL: () => LOCAL_PAGE };
  assert.equal(ask("media", { requestingUrl: LOCAL_PAGE, isMainFrame: true, mediaTypes: ["audio"] }, local), true);
  assert.equal(ask("media", { requestingUrl: LOCAL_PAGE, isMainFrame: true, mediaTypes: [] }, local), true, "guarded display capture");
  assert.equal(ask("media", { requestingUrl: LOCAL_PAGE, isMainFrame: true, mediaTypes: ["video"] }, local), false);
  assert.equal(ask("notifications", { requestingUrl: LOCAL_PAGE, isMainFrame: true }, local), true);
  assert.equal(ask("notifications", {}, local), true);
  assert.equal(check("clipboard-read", "", { isMainFrame: true }, local), true);
  assert.equal(check("clipboard-read", "https://other.example", { isMainFrame: true }, local), false);
});
