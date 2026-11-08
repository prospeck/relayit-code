// Retain the Windows notification-area identity across app restarts.
export function createSystemTray({ Tray, Menu, nativeImage, iconPath, getWindow, onQuit }) {
  // A macOS template image (black, with its @2x beside it) is used as it is and recoloured for the menu bar.
  const template = /Template\.png$/.test(iconPath);
  const image = template ? nativeImage.createFromPath(iconPath) : nativeImage.createFromPath(iconPath).resize({ width: 20, height: 20 });
  if (template) image.setTemplateImage?.(true);
  const tray = new Tray(image, "889af657-21b5-4ec9-b5d0-cb798cbdfd30");
  let hidden = false;
  const show = () => {
    const win = getWindow();
    if (!win || win.isDestroyed()) return false;
    hidden = false;
    win.setSkipTaskbar(false);
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
    return true;
  };
  tray.setToolTip("RelayIt");
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: "Open RelayIt", click: show },
    { type: "separator" },
    { label: "Quit RelayIt", click: onQuit },
  ]));
  tray.on("click", show);
  tray.on("double-click", show);
  return {
    show,
    hide(win) { hidden = true; win.setSkipTaskbar(true); win.hide(); },
    isHidden() { return hidden; },
    windowShown(win) { hidden = false; win.setSkipTaskbar(false); },
    destroy() { if (!tray.isDestroyed()) tray.destroy(); },
  };
}
