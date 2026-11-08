import { fileURLToPath } from 'node:url';

// The Lane mark (shared/brand-mark.ts), inlined because the splash is a data: page that loads nothing. The runner laps
// the track once and settles in the open quarter: the job goes round, and comes back to you.
const TRACK = "M39.2 15.2H24.8a16.8 16.8 0 0 0 0 33.6h14.4a16.8 16.8 0 0 0 16.8-16.8";
const LAP = `${TRACK}a16.8 16.8 0 0 0-4.9-11.9`;
const RELAY = "M204 330H485Q538 330 569.0 305.5Q600 281 600 237Q600 193 569.0 168.5Q538 144 485 144H177L262 51V750H73V0H510Q594 0 657.0 30.0Q720 60 755.0 113.0Q790 166 790 237Q790 307 755.0 360.0Q720 413 657.0 443.0Q594 473 510 473H204ZM325 399H538L814 750H595ZM1227 766Q1125 766 1044.5 728.0Q964 690 918.0 622.0Q872 554 872 463Q872 374 916.0 307.0Q960 240 1037.5 202.0Q1115 164 1213 164Q1313 164 1385.0 208.0Q1457 252 1496.0 332.0Q1535 412 1535 520H1021V403H1433L1366 445Q1363 398 1343.5 365.5Q1324 333 1292.0 315.5Q1260 298 1216 298Q1168 298 1133.0 317.0Q1098 336 1078.5 370.0Q1059 404 1059 449Q1059 506 1084.5 546.0Q1110 586 1158.5 607.0Q1207 628 1277 628Q1341 628 1405.0 610.5Q1469 593 1520 561V682Q1462 722 1387.5 744.0Q1313 766 1227 766ZM1628 -20H1813V750H1628ZM2451 750 2426 543 2453 465 2426 388 2451 180H2644L2609 465L2644 750ZM2497 465Q2482 556 2440.0 623.5Q2398 691 2334.0 728.5Q2270 766 2190 766Q2106 766 2042.5 728.0Q1979 690 1943.0 622.5Q1907 555 1907 465Q1907 375 1943.0 307.5Q1979 240 2042.5 202.0Q2106 164 2190 164Q2270 164 2334.0 201.5Q2398 239 2440.5 306.0Q2483 373 2497 465ZM2095 465Q2095 511 2114.0 546.5Q2133 582 2166.5 602.5Q2200 623 2244 623Q2288 623 2327.5 602.5Q2367 582 2397.0 546.5Q2427 511 2442 465Q2427 419 2397.0 383.5Q2367 348 2327.5 327.5Q2288 307 2244 307Q2200 307 2166.5 327.5Q2133 348 2114.0 383.5Q2095 419 2095 465ZM2923 931Q2863 931 2816.5 916.0Q2770 901 2726 871V740Q2771 769 2810.5 781.5Q2850 794 2897 794Q2939 794 2970.5 776.0Q3002 758 3023 710L3251 180H3448L3169 768Q3141 828 3102.0 864.0Q3063 900 3017.5 915.5Q2972 931 2923 931ZM2945 705 2698 180H2902L3124 705Z";
const IT = "M3523 0H3712V750H3523ZM3790 318V237L3908 194L3988 28H4094V180H4340V318H4094V506Q4094 570 4120.0 595.5Q4146 621 4213 621Q4256 621 4288.5 613.5Q4321 606 4350 593V734Q4320 746 4271.5 756.0Q4223 766 4171 766Q4080 766 4021.5 737.0Q3963 708 3935.5 655.5Q3908 603 3908 532V318Z";

export function startupScreenHtml() {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'"><title>RelayIt</title><style>
  *{box-sizing:border-box}html,body{margin:0;width:100%;height:100%;overflow:hidden;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif;background:transparent}
  main{--ground:#fff;--ink:#111;--quiet:#5a5a56;--rim:#1111111a;--coral:#ff4f2e;height:100%;position:relative;display:flex;flex-direction:column;align-items:center;justify-content:center;border:1px solid var(--rim);border-radius:20px;background:var(--ground);color:var(--ink);-webkit-app-region:drag}
  @media(prefers-color-scheme:dark){main{--ground:#0f1211;--ink:#f4f4f1;--quiet:#a3a8a5;--rim:#f4f4f11a;--coral:#ff5a3a}}
  .mark{width:84px;height:84px;overflow:visible;margin-bottom:22px}
  .track{fill:none;stroke:var(--ink);stroke-width:6.72;stroke-linecap:round;stroke-dasharray:132;stroke-dashoffset:132;animation:draw .7s cubic-bezier(.65,0,.35,1) .1s forwards}
  .runner{fill:var(--coral);offset-path:path("${LAP}");offset-rotate:0deg;offset-distance:0%;animation:lap 1.05s cubic-bezier(.45,0,.2,1) .35s both,breathe 1.6s ease-in-out 1.6s infinite}
  h1{margin:0 0 24px;height:26px;opacity:0;animation:rise .45s cubic-bezier(.22,1,.36,1) 1.05s forwards}
  h1 svg{height:26px;width:auto;display:block}.relay{fill:var(--ink)}.it{fill:var(--coral)}
  .sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)}
  .status{min-height:18px;color:var(--quiet);font-size:12.5px;line-height:18px;opacity:0;animation:rise .45s cubic-bezier(.22,1,.36,1) 1.25s forwards}
  button{position:absolute;right:13px;top:13px;width:30px;height:30px;display:grid;place-items:center;padding:0;color:var(--quiet);border:0;border-radius:15px;background:transparent;cursor:pointer;-webkit-app-region:no-drag}
  button:hover{color:var(--ink);background:var(--rim)}button:focus-visible{outline:2px solid var(--coral);outline-offset:2px}button svg{pointer-events:none}
  @keyframes draw{to{stroke-dashoffset:0}}
  @keyframes lap{from{offset-distance:0%}to{offset-distance:100%}}
  @keyframes breathe{50%{transform:scale(1.18)}}
  @keyframes rise{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}
  @media(prefers-reduced-motion:reduce){.track,.runner,h1,.status{animation:none;opacity:1}.track{stroke-dashoffset:0}.runner{offset-distance:100%}}
  </style></head><body><main><button aria-label="Close" onclick="window.startupScreen.close()"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg></button><svg class="mark" viewBox="0 0 64 64" aria-hidden="true"><path class="track" pathLength="132" d="${TRACK}"/><circle class="runner" r="6"/></svg><h1><svg viewBox="0 -24 4376 960" aria-hidden="true"><path class="relay" d="${RELAY}"/><path class="it" d="${IT}"/></svg><span class="sr">RelayIt</span></h1><div class="status" role="status">Getting ready…</div></main></body></html>`;
}

export function createStartupScreen({
  BrowserWindow, iconPath, platform = process.platform, isQuitting, onQuit,
  onHide, isHidden = () => false, onShow, onFinished,
}) {
  let disposed = false, revealed = false, fallback, resolveReady;
  const ready = new Promise(resolve => { resolveReady = resolve; });
  const splash = new BrowserWindow({
    width: 440, height: 300, resizable: false, maximizable: false,
    fullscreenable: false, frame: false, transparent: true,
    backgroundColor: "#00000000", show: false, icon: iconPath,
    title: "RelayIt", autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true, sandbox: true, nodeIntegration: false,
      preload: fileURLToPath(new URL("./startup-screen-preload.cjs", import.meta.url)),
    },
  });
  splash.setMenu(null);
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    clearTimeout(fallback);
    resolveReady();
    if (!splash.isDestroyed()) splash.destroy();
    onFinished?.();
  };
  splash.on("close", event => {
    if (disposed || isQuitting()) return;
    event.preventDefault();
    if (platform === "win32" && onHide) onHide(splash);
    else onQuit();
  });
  // Renderer window.close() bypasses BrowserWindow's cancellable close path, so the page asks for the native one.
  splash.webContents.on("ipc-message", (_event, channel) => {
    if (channel === "startup-screen:close" && !disposed) splash.close();
  });
  let shown = false;
  const showSplash = () => {
    if (shown || disposed || isQuitting()) return;
    shown = true; splash.show(); resolveReady();
  };
  splash.once("ready-to-show", showSplash);
  // Some Wayland compositors (COSMIC) never paint a hidden window, so ready-to-show never comes.
  splash.webContents.once("did-finish-load", () => {
    const grace = setTimeout(showSplash, 500);
    grace.unref?.();
  });
  splash.on("show", () => onShow?.(splash));
  splash.once("closed", resolveReady);
  // The splash stays until the main window replaces it: as the only window, destroying it would quit the app.
  splash.webContents.once("render-process-gone", resolveReady);
  let said = null;
  const say = () => {
    if (said === null || disposed || splash.isDestroyed()) return;
    void splash.webContents.executeJavaScript(`(() => { const line = document.querySelector('.status'); if (line?.lastChild) line.lastChild.textContent = ${JSON.stringify(said)}; })()`).catch(() => {});
  };
  splash.webContents.on("did-finish-load", say);
  const startupFallback = setTimeout(resolveReady, 10_000);
  startupFallback.unref?.();
  void splash.loadURL("data:text/html;charset=utf-8," + encodeURIComponent(startupScreenHtml()))
    .catch(resolveReady);
  const attach = (win, { maximized = false } = {}) => {
    const reveal = () => {
      if (revealed || win.isDestroyed() || isQuitting()) return;
      revealed = true;
      const minimized = !splash.isDestroyed() && splash.isMinimized();
      if (isHidden()) {
        win.setSkipTaskbar(true);
        win.hide();
        if (maximized) win.once("show", () => win.maximize());
      } else {
        if (maximized) win.maximize();
        if (minimized) { win.showInactive(); win.minimize(); }
        else { win.show(); win.focus(); }
      }
      dispose();
    };
    win.webContents.on("did-finish-load", () => {
      if (revealed || win.isDestroyed() || isQuitting()) return;
      void win.webContents.executeJavaScript(`new Promise(resolve => {
        const root = document.getElementById('root');
        if (!root || root.childElementCount) { resolve(); return; }
        const observer = new MutationObserver(() => {
          if (root.childElementCount) { observer.disconnect(); resolve(); }
        });
        observer.observe(root, { childList: true });
      })`).then(reveal).catch(reveal);
    });
    win.webContents.once("render-process-gone", reveal);
    win.once("show", () => { if (!revealed) { revealed = true; dispose(); } });
    win.once("closed", dispose);
    fallback = setTimeout(reveal, 10_000);
    fallback.unref?.();
  };
  /** The line under the name, in place of "Getting ready…". */
  const status = (text) => { said = String(text); say(); };
  return { ready, attach, dispose, status, window: splash };
}
