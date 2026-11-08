// The native chrome CSS cannot reach (the Windows caption-button overlay accepts no alpha, so opaque hex).
// Keep in step with src/styles.css and src/lib/skins.ts.
"use strict";

const SKIN_CHROME = Object.freeze({
  midnight: Object.freeze({ color: "#0f1211", symbolColor: "#b4b9b6" }),
  daylight: Object.freeze({ color: "#ffffff", symbolColor: "#5a5a56" }),
});

const DEFAULT_SKIN = "midnight";

function skinChrome(skin) {
  return Object.hasOwn(SKIN_CHROME, skin) ? SKIN_CHROME[skin] : SKIN_CHROME[DEFAULT_SKIN];
}

function isKnownSkin(skin) {
  return Object.hasOwn(SKIN_CHROME, skin);
}

/** A light skin: its page colour is nearer white than black. */
function skinIsLight(skin) {
  const hex = skinChrome(skin).color;
  const [r, g, b] = [1, 3, 5].map((at) => parseInt(hex.slice(at, at + 2), 16));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 127.5;
}

module.exports = { SKIN_CHROME, DEFAULT_SKIN, skinChrome, isKnownSkin, skinIsLight };
