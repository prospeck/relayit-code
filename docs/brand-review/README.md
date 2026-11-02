# RelayIt brand review

The mark follows the supplied RelayIt R, whose forward leg suggests a baton handoff, on the ember gradient `#F07040` → `#D9481F`. Bot identities use the same R on original geometric tiles, retaining each bot's colour. Distinct static symbols communicate idle, working, waiting, attention and complete. Working and waiting have restrained animation; reduced motion disables it. Runtime waiting and working take priority over saved appearance choices. Job titles no longer imply activity or a character expression.

## Screenshots

All six were captured with Playwright using `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`, at 1440 × 1000, and individually opened for visual inspection.

- [Sidebar and chat, light](chat-light.png)
- [Sidebar and chat, dark](chat-dark.png)
- [Bot appearance editor, light](look-light.png)
- [Bot appearance editor, dark](look-dark.png)
- [Computer pointer and token states, light](computer-light.png)
- [Computer pointer and token states, dark](computer-dark.png)

The chat and appearance captures mount the real app against the disposable fake-engine backend. The computer captures mount the real `AgentCursor` and `BotAvatar` components on an explicitly labelled synthetic surface, with all five states and all twelve colours at 36 px and 20 px. They do not prove a live operating-system computer-control session. Browser page errors: **0**. Browser reduced-motion check: **passed**. The desktop icon and the 720 × 440 installer background were also opened and inspected.

## Changed files

- `scripts/make-brand-icons.mjs`, `build/icon*`, `build/dmg/background.svg`, `build/dmg/render.mjs`, `build/background*.png`, `public/app-icon*`, `public/apple-touch-icon.png`, `public/manifest.webmanifest`, `electron/resources/app-icon.png`: reproducible RelayIt vector and raster art; all existing iconset sizes; macOS ICNS; Windows ICO with 16/24/32/48/64/128/256 px entries; installer art at 1× and 2×. `electron-builder.yml` references were checked. The tray uses the replaced `electron/resources/app-icon.png`.
- `src/components/RelayMark.tsx`, `RelayToken.tsx`, `Avatar.tsx`, `StackedTokens.tsx`, `TokenMarkColorPicker.tsx`, `src/lib/token-state.ts`, `src/lib/mascot.ts`, `shared/relay-tokens.ts`, `shared/seasonal-tokens.ts`, `src/styles.css`: the new identity system and status rendering. Related avatar pickers, sidebar, skin previews and tests use it. Upload framing and persisted appearance IDs remain compatible.
- `src/components/browser/AgentCursor.tsx`, `StreamSurface.tsx`, `src/components/BrowserPanel.tsx`: R pointer with the active bot's colour; position, fading, input and control ownership behavior retained.
- `src/components/whats-new/WhatsNewPopup.tsx`: live Relay-token handoff art replaces bundled screenshots bearing the upstream mouse logo.
- `src/locales/*.json`, `source-hashes.json`: natural token/status/mark-colour copy across all 16 packs, neutral provider information, and short upstream character/product names outside the later word rename. Locale key/hash validation passes.
- `src/components/BoatOffer.tsx`, `src/lib/boat-offer.ts`, related tests: removed the upstream credit-claim action and email draft; the panel only links to the third-party provider. `electron/app-permissions.node-test.mjs` uses a synthetic email fixture instead of importing the deleted promotional helper; permission-policy code is unchanged.
- `README.md`: current brand screenshot, source-history wording, no upstream sponsorship badges, credit claims or embedded old UI screenshots. Unused sponsor SVGs removed.
- `server/testing/fixtures/composio-calendar-events.json` and its assertion: synthetic event title no longer uses the upstream company name. Other server/shared edits only update token catalog imports.
- `scripts/verify-relay-brand.ts`, `src/testing/relay-brand.tsx`, `scripts/capture-relay-brand.mjs`: repeatable disposable review fixture and Chrome captures. The fixture signals its owned backend before Vite's process-exit handling.

Removed: `CursorAvatar`, `CarvedAvatar`, mouse face geometry, frame/morph engine, steel mouse images and their loader, original generated gradient and seasonal body catalogs, `scripts/mascot-bodies/`, both body generators, the old mascot preview page/CSS/entry, and the implementation-specific mouse/generator/clock tests. `mascot-clock.ts` now contains only the reduced-motion hook still used by onboarding. Shard timing metadata and generator package scripts were cleaned up.

## Checks

All commands ran in `/Users/work/relayit-next-brand`. Test runs were serial. No dependency install, Electron launch, packaging, push or git configuration change was performed.

```sh
node scripts/make-brand-icons.mjs
# Passed: iconutil, all vector/raster icon outputs and both installer backgrounds.

NODE_OPTIONS=--max-old-space-size=1500 npx vitest run \
  src/components/RelayToken.test.ts src/components/Avatar.test.ts \
  src/components/BotProfileAvatarCard.test.ts src/components/BotSettingsDialog.simple.test.ts \
  src/components/BotIdentityAvatars.test.ts src/components/PluginsPanel.navigation.test.ts \
  src/components/MausBotWelcome.test.ts src/components/unread-notice.test.ts \
  src/components/AppNotices.test.ts src/components/whats-new/WhatsNewPopup.test.ts \
  src/lib/mascot.test.ts src/lib/halloween-dress.test.ts src/lib/ready-bots.test.ts \
  src/lib/i18n.test.ts src/lib/boat-offer.test.ts src/locales/vocabulary.test.ts \
  src/locales/screen-words.test.ts src/locales/welcome-words.test.ts \
  shared/bot-body.test.ts server/bot-look.test.ts server/connected-reads.test.ts \
  --no-file-parallelism --maxWorkers=1
# 21 files, 306 tests passed, 0 failed.

NODE_OPTIONS=--max-old-space-size=1500 npx vitest run \
  src/components/RelayToken.test.ts src/lib/mascot.test.ts \
  src/components/keys/KeysPage.dom.test.ts --no-file-parallelism --maxWorkers=1
# Follow-up after adding runtime-waiting coverage and removing the final claim-helper dependency:
# 3 files, 23 tests passed, 0 failed. Some overlap with the preceding run.

NODE_OPTIONS=--max-old-space-size=1500 npx vitest run \
  src/components/browser/StreamSurface.test.ts --no-file-parallelism --maxWorkers=1
# 1 file, 15 tests passed, 0 failed, including pointer colour and human-control hiding.

NODE_OPTIONS=--max-old-space-size=1500 node --test electron/startup-tray.node-test.mjs
# 12 passed, 0 failed; mocked Electron classes, no Electron application launched.

NODE_OPTIONS=--max-old-space-size=1500 node --test electron/app-permissions.node-test.mjs
# 35 passed, 0 failed.

NODE_OPTIONS=--max-old-space-size=3500 npx tsc -p tsconfig.server.json --noEmit
NODE_OPTIONS=--max-old-space-size=3500 npx tsc -b
# Both passed, exit 0. Neither aborted for memory.

node scripts/generate-locale.mjs --check
# Passed: 16 languages, 7383 English keys; translated packs retain their existing partial coverage.
git diff --check
# Passed.
```

Earlier checks caught stale mouse-geometry assertions, a duplicate label, a stale vocabulary exemption and remaining imports of the removed promotional helper. Those were corrected. Initial screenshot attempts were rejected because onboarding covered the chat or the capture selected the advanced profile instead of the appearance panel; the six retained images are the successful final captures. The first fixture cleanup left backend children; those exact processes were stopped, the fixture signal ordering was corrected, and shutdown was checked again.

## Reproduce the visual review

```sh
OMB_DATA_DIR=$(mktemp -d) NODE_OPTIONS=--max-old-space-size=1500 \
  node --experimental-strip-types scripts/verify-relay-brand.ts
# Use its printed loopback preview URL in a second terminal:
PLAYWRIGHT_MODULE=/Users/work/relayit-code/node_modules/playwright-core/index.mjs \
  node scripts/capture-relay-brand.mjs http://127.0.0.1:PORT/__relay-brand.html
# Stop the launcher with Ctrl-C, or SIGTERM its printed pid.
```

The backend uses `launchVerificationServer`'s own fresh temporary data directory and home; the outer `OMB_DATA_DIR` also protects launcher imports and Vite. No installed app or `~/.openmausbot` data was used. Chrome starts with Playwright's disposable profile and closes in `finally`.

## Remaining names and limits

- Plain `OpenMausBot`/`MausBot` words remain for the separately scheduled `scripts/rebrand-to-relayit.mjs`; this work did not run or duplicate that global rename.
- `mascot*`, `MausColor`, `MausAvatar`, `runOn: "maus"`, the `mascot` crop and old body IDs remain as persisted settings, wire/file-format values, compatibility type names, locale keys or test fixtures. They do not select or render upstream art. `.mausbackup.json` / `.mausteam.json` name supported legacy import formats.
- `mouse`, `MouseEvent`, pointer-input methods, and German `Maus` describe the hardware pointing device. The two remaining German locale values concern screen/mouse/keyboard actions.
- `CursorMark.tsx` is the third-party Cursor provider's mark, used only to identify that engine. It is unrelated to the removed character renderer.
- `LICENSING.md` retains the upstream trademark owner's legal name; license/history material is intentionally preserved. `LICENSE`, `NOTICE`, `third_party/` and `UPSTREAM.md` were not modified.
- The rebrand script retains upstream-name detection patterns. `cloudflare/control-plane/wrangler.jsonc` retains an upstream account comment in code owned by the separate cloud-removal workstream.
- Historical upstream documentation and verification screenshots under `docs/` remain archival evidence. They are not bundled in the app; the README no longer embeds their old UI artwork. Current review screenshots are only the six listed above.
- No full test suite, production bundle, native packaged app, Windows shell or live computer-control session was run. Translation wording has not had a separate native-language editorial review.
