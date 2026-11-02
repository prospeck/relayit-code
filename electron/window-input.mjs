export function createWindowInput(window, now = Date.now) {
  let last = 0;
  const watched = new WeakSet();
  return {
    lastInput() {
      const win = window();
      if (win && !win.isDestroyed() && !watched.has(win.webContents)) {
        watched.add(win.webContents);
        win.webContents.on("before-input-event", () => { last = now(); });
        last = Math.max(last, now());
      }
      return last;
    },
  };
}
