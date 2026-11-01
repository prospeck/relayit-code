# RelayIt desktop accessibility and interaction audit

Audited the checked-out React UI without changing `apps/desktop/src/`. Chrome 156, Node 26.11.1, the real Vite app, an in-process core, offline model, built-in demo connectors, and synthetic local data were used. The six required views were exercised in light and dark schemes at 940×620 and 1600×1000. Source review also covered Onboarding, Skills, Routines, Quick Ask and payment cards. Native Tauri windows, system shortcuts, real microphones, provider accounts, external checkout, and an actual screen reader were not exercised.

The automated suite is `e2e/a11y.test.ts`. It runs axe's WCAG 2.1 A/AA rules and explicit interaction, geometry, motion, heading and token checks. Known defects have individual `it.fails` assertions: green means those defects were reproduced, **not** that the UI conforms. Untracked axe violations fail normally; removing a defect makes its expected-failure test fail until converted to `it`. Axe's incomplete contrast results on gradients/animations are supplemented by token calculations; they are not treated as passes. Tests do not reload the normal demo flow to work around missing updates. Reload is used only to load an explicitly changed synthetic layout fixture.

Use [WCAG contrast minimum](https://www.w3.org/WAI/WCAG21/Understanding/contrast-minimum.html), [non-text contrast](https://www.w3.org/WAI/WCAG21/Understanding/non-text-contrast.html), and [status messages](https://www.w3.org/WAI/WCAG21/Understanding/status-messages.html) as the AA criteria. Ordinary text requires 4.5:1, large text (24px regular or 18.66px bold) 3:1, and necessary control boundaries/state indicators 3:1. Small 500/600-weight labels were conservatively checked at 4.5:1. The requested ≥24×24px target check is a product requirement here; [WCAG 2.2 SC 2.5.8](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html) adds that minimum with spacing exceptions. It is not a WCAG 2.1 AA requirement. Suppressing all interaction animation is also a requested quality improvement; interaction animation itself is addressed at AAA (2.3.3).

## Ranked findings

### A01 — High: text, control and focus contrast

**Where:** `apps/desktop/src/styles/index.css:12` (light), `:60` (dark), `:183` (focus); `components/ui/index.tsx:18`, `:83`, `:188` (buttons, fields, switches). All source paths below are relative to `apps/desktop/src/`.

**Affected:** low-vision users, users in bright light, and keyboard users trying to locate focus. Faint text fails in both themes. Light muted text fails on all audited neutral backgrounds except white. White primary-button labels fail in both themes, including hover. Light success/warning/danger/info badge text and accent text on soft surfaces fail. There is no large-text exemption for the 11–15px labels. Large approval amounts and the Today display heading pass with their current ink colours.

**Measurement:** sRGB linearization, `(Llighter + .05)/(Ldarker + .05)`, no rounding before comparisons. Alpha backgrounds are composited over the indicated opaque base before calculating luminance. Exact source values are listed below; ratios are displayed to three decimals. Each row identifies a failing pair and a specific replacement that passes. Soft colours remain unchanged; keep their current warm/translucent appearance. `--surface-3` is included because hover/selected controls use it. Both `--bg` and `--surface` soft-background bases are checked conservatively (badges/notices are normally on surface; the reusable components may also sit directly on the page).

| Theme | Foreground token: current | Background token: exact current value (base) | Current ratio | Proposed replacement | New ratio |
|---|---|---|---:|---|---:|
| Light | `--muted: #77726a` | `--bg: #f6f4f0` | 4.345 | `--muted: #6b655d` | 5.245 |
| Light | `--muted: #77726a` | `--surface-2: #f3f0eb` | 4.199 | `--muted: #6b655d` | 5.069 |
| Light | `--muted: #77726a` | `--bg-sidebar: #efece7` | 4.051 | `--muted: #6b655d` | 4.890 |
| Light | `--muted: #77726a` | `--surface-3: #ebe7e1` | 3.876 | `--muted: #6b655d` | 4.678 |
| Light | `--faint: #a8a39b` | `--bg: #f6f4f0` | 2.282 | `--faint: #6b655d` | 5.245 |
| Light | `--faint: #a8a39b` | `--surface: #ffffff` | 2.507 | `--faint: #6b655d` | 5.762 |
| Light | `--faint: #a8a39b` | `--surface-2: #f3f0eb` | 2.205 | `--faint: #6b655d` | 5.069 |
| Light | `--faint: #a8a39b` | `--bg-sidebar: #efece7` | 2.127 | `--faint: #6b655d` | 4.890 |
| Light | `--faint: #a8a39b` | `--surface-3: #ebe7e1` | 2.035 | `--faint: #6b655d` | 4.678 |
| Light | `--accent-text: #c2461f` | `--accent-soft: rgb(228 87 46 / 0.09)` over `--bg: #f6f4f0` | 4.111 | `--accent-text: #a93c1b` | 5.143 |
| Light | `--accent-text: #c2461f` | `--accent-soft: rgb(228 87 46 / 0.09)` over `--surface: #ffffff` | 4.493 | `--accent-text: #a93c1b` | 5.620 |
| Light | `--success: #23885b` | `--success-soft: rgb(35 136 91 / 0.1)` over `--bg: #f6f4f0` | 3.576 | `--success: #196c45` | 5.184 |
| Light | `--success: #23885b` | `--success-soft: rgb(35 136 91 / 0.1)` over `--surface: #ffffff` | 3.908 | `--success: #196c45` | 5.665 |
| Light | `--warning: #b77a0c` | `--warning-soft: rgb(183 122 12 / 0.1)` over `--bg: #f6f4f0` | 2.967 | `--warning: #805209` | 5.503 |
| Light | `--warning: #b77a0c` | `--warning-soft: rgb(183 122 12 / 0.1)` over `--surface: #ffffff` | 3.240 | `--warning: #805209` | 6.009 |
| Light | `--danger: #cf3f36` | `--danger-soft: rgb(207 63 54 / 0.09)` over `--bg: #f6f4f0` | 3.832 | `--danger: #b5322c` | 4.896 |
| Light | `--danger: #cf3f36` | `--danger-soft: rgb(207 63 54 / 0.09)` over `--surface: #ffffff` | 4.190 | `--danger: #b5322c` | 5.354 |
| Light | `--info: #3d6fd9` | `--info-soft: rgb(61 111 217 / 0.09)` over `--bg: #f6f4f0` | 3.827 | `--info: #315fc0` | 4.853 |
| Light | `--info: #3d6fd9` | `--info-soft: rgb(61 111 217 / 0.09)` over `--surface: #ffffff` | 4.185 | `--info: #315fc0` | 5.307 |
| Light | `--on-accent: #ffffff` | `--accent: #e4572e` | 3.683 | `--accent: #bd431f` | 5.268 |
| Light | `--on-accent: #ffffff` | `--accent-hover: #d14b23` | 4.429 | `--accent-hover: #ac391a` | 6.261 |
| Dark | `--faint: #6d6963` | `--bg: #141311` | 3.405 | `--faint: #a19990` | 6.609 |
| Dark | `--faint: #6d6963` | `--surface: #1c1b19` | 3.156 | `--faint: #a19990` | 6.126 |
| Dark | `--faint: #6d6963` | `--surface-2: #232220` | 2.915 | `--faint: #a19990` | 5.658 |
| Dark | `--faint: #6d6963` | `--bg-sidebar: #181715` | 3.285 | `--faint: #a19990` | 6.376 |
| Dark | `--faint: #6d6963` | `--surface-3: #2c2a27` | 2.624 | `--faint: #a19990` | 5.093 |
| Dark | `--on-accent: #ffffff` | `--accent: #f26a3d` | 3.042 | `--on-accent: #1c1a16` | 5.712 |
| Dark | `--on-accent: #ffffff` | `--accent-hover: #ff7a4d` | 2.579 | `--on-accent: #1c1a16` | 6.737 |
| Dark | `--on-accent: #ffffff` | `--accent-press: #e45d30` | 3.555 | `--on-accent: #1c1a16` | 4.887 |

Every required `--text` and `--text-2` neutral pair passes: light ranges 14.745–17.374 and 7.960–9.379 respectively; dark 13.878–16.211 and 10.153–11.860. Dark muted pairs are 5.478–6.399. Dark semantic text on its soft background passes over both bases: accent-text 6.139–6.706, success 5.808–6.375, warning 6.273–6.898, danger 4.523–4.938, info 4.921–5.393. Light white-on-accent-press already passes (5.332); changing it to `#963116` keeps the new button state progression consistent and gives 7.643. Dark white arrow icons on default accent just meet the non-text 3:1 threshold (3.042), but hover falls to 2.579; using dark `--on-accent` fixes both text and icons.

Other actual blends: light muted over the selected Model tile (`--accent-softer`, `rgb(228 87 46 / .05)` over bg) is 4.094; proposed muted gives 4.942. Light muted over the gradient's most tinted surface endpoint (`--accent-softer` over surface) is 4.501; it passes narrowly, while the page subtitle does not. `--muted` over the approval details/footer `--surface-2` at 40% over surface is 4.538 (passes); proposed muted is 5.480. Light faint over `--surface-2` at 50% over bg (Tasks columns) is 2.243; proposed faint is 5.158. Dark faint over that same column blend is 3.163; proposed faint is 6.142. These translucent cases are bounded by the neutral/soft replacement checks in the suite.

The global focus shadow is only `rgb(228 87 46 / .22)` in light and `rgb(242 106 61 / .3)` in dark. It is visible to ordinary vision but falls short of 3:1 against the neutral backgrounds (approximately 1.35–1.40 light, 1.51–1.54 dark). The author removed the native outline. `--border` contrasts are only 1.170–1.175 light / 1.201–1.243 dark; `--border-strong` 1.326–1.335 / 1.426–1.486 on the four required bases. Decorative card borders need not meet 3:1, but field boundaries and the unchecked switch state do.

**Exact CSS proposal:** apply the replacements from the table to the existing theme blocks, add `--control-border: #8a8175` in both blocks, and replace `--ring` with `0 0 0 3px var(--accent-text)`. `#8a8175` gives at least 3.113 on light neutral backgrounds including surface-3 and 3.732 on dark ones. In `fieldBase` (`components/ui/index.tsx:83`), replace `border-line-strong` with `border-[var(--control-border)]`. Do the same for the unchecked switch at `:188`. Use an offset outline so a focus cue is not obscured by a button's own shadow:

```css
:focus-visible:not(input, textarea, select) {
  outline: 2px solid var(--accent-text);
  outline-offset: 3px;
  border-radius: 8px;
}
input:focus-visible, textarea:focus-visible, select:focus-visible {
  outline: 2px solid var(--accent-text);
  outline-offset: 3px;
}
```

The current `fieldBase` focus shadow and Composer `focus-within` shadow can remain once `--ring` is opaque. The suite verifies proposed text replacements mathematically; the proposal has not been applied or visually reviewed as an implemented theme.

### A02 — High: a money hold continues after keyboard focus leaves

**Where:** `components/ApprovalCard.tsx:188`–`:218`.

**Affected:** keyboard and switch-control users. Enter/Space short presses correctly do nothing, and a full hold correctly approves once. However, keydown → Tab → release outside the button leaves its requestAnimationFrame timer running. `onKeyUp` is attached only to the old button, with no `onBlur` cancellation. There is also no pointer-cancel or unmount cleanup. A user can leave the control and still authorize an order. This is an interaction safety defect, not evidence of an unauthorized bank payment; the demo still requires the UPI handoff.

**Exact proposal:** add `onBlur={cancel}` and `onPointerCancel={cancel}` to the button; in `cancel`, set `raf.current = null` after cancelling it. At the start of `begin`, use `if (disabled || raf.current !== null) return;` to avoid multiple loops. Clear `raf.current` immediately before `onConfirm()`. Add unmount cleanup:

```tsx
useEffect(() => () => {
  if (raf.current !== null) cancelAnimationFrame(raf.current);
}, []);
```

Replace the key handlers with:

```tsx
onKeyDown={(e) => {
  if (e.key !== "Enter" && e.key !== " ") return;
  e.preventDefault(); // Prevent Space from scrolling the transcript.
  if (!e.repeat) begin();
}}
onKeyUp={(e) => {
  if (e.key === "Enter" || e.key === " ") {
    e.preventDefault();
    cancel();
  }
}}
```

Cancel an active hold if `disabled` becomes true. Keep the 750ms threshold and keep ordinary click from approving. The suite covers short/full/repeated Enter and Space plus blur cancellation in both schemes; pointer-cancel and unmount behaviour were identified by source review.

### A03 — High: voice input cannot be operated by keyboard

**Where:** `components/Composer.tsx:124`–`:136`, `:167`–`:199`. WCAG 2.1.1.

**Affected:** keyboard-only and motor-impaired users. The mic has a good accessible name, but only pointer-down/up start and stop recording. Enter/Space clicks call nothing. The permission error also says System Settings even when browser permission is the cause.

**Exact proposal:** retain the pointer handlers and add the following to the mic button:

```tsx
onKeyDown={(e) => {
  if (e.key === "Enter" || e.key === " ") {
    e.preventDefault();
    if (!e.repeat && !voice.busy) voice.start();
  }
}}
onKeyUp={(e) => {
  if (e.key === "Enter" || e.key === " ") {
    e.preventDefault();
    voice.stop();
  }
}}
onBlur={voice.stop}
onPointerCancel={voice.stop}
aria-pressed={voice.recording}
aria-label={voice.recording ? "Recording; release to stop" : "Hold to talk"}
disabled={voice.busy}
```

Inside `useVoice`, add `const stopRequested = useRef(false);`. Set it to false immediately on entering `start`, set it true immediately on entering `stop`, and after `getUserMedia` resolves add `if (stopRequested.current) { stream.getTracks().forEach((t) => t.stop()); return; }`. This prevents a late permission response from starting recording after release. Replace the error copy with `Microphone access was blocked. Check microphone permissions for RelayIt or your browser.` Render the error with `role="alert"`. The test stubs permission requests and never records audio.

### A04 — High: streaming, waiting, new approvals and errors are silent

**Where:** `screens/Chat.tsx:107`–`:127`; `components/MessageView.tsx:115`–`:128`; `components/ApprovalCard.tsx:159`; `screens/QuickAsk.tsx:69`–`:74`; `screens/Settings.tsx:56`. WCAG 4.1.3.

**Affected:** screen-reader users. No log/live region surrounds completed replies or new approval cards. “Thinking…” is just a shimmering div. New cards arrive without focus or announcement. “Saved”, approval errors, voice errors and send errors also lack live status semantics.

**Exact proposal:** keep a mounted status element before Chat's scroller and wrap only the completed `messages.map(...)` in a log. Do not announce every token of the live Markdown or move focus to each new message:

```tsx
<div role="status" aria-live="polite" aria-atomic="true" className="sr-only">
  {run?.active ? run.status || "Thinking…" : ""}
</div>
// In the transcript, around the existing completed message map:
<div role="log" aria-label="Conversation" aria-live="polite"
     aria-relevant="additions" aria-atomic="false" className="space-y-7">
  {messages.map((m, i) => (
    <MessageView key={m.id} message={m} actions={actions}
      isLast={i === messages.length - 1 && !run}
      onChoice={(t) => send.mutate(t)} />
  ))}
</div>
```

Keep `LiveRunView` outside this log and mark its duplicate visual status `aria-hidden="true"`; announce the final reply/card once when its completed message is inserted. For updates to an existing action, add another mounted polite status with the pending action titles/status changes derived from `detail.data.actions`; avoid nested live regions on interactive cards. Add `role="alert"` to Chat send errors and ApprovalCard's error paragraph. Add `role="status"` to `Saved`. Give Quick Ask a mounted polite status and announce only its completed answer/pending action once. Verify actual announcement frequency with VoiceOver/NVDA after applying; DOM checks do not establish spoken behaviour.

### A05 — High: hover-only actions disappear during keyboard use

**Where:** `components/Sidebar.tsx:113`–`:119`; `screens/Tasks.tsx:128`; analogous delete/forget buttons in `screens/Skills.tsx:65`, `screens/Routines.tsx:90`, `screens/Settings.tsx:366`. WCAG 2.1.1, 2.4.7.

**Affected:** keyboard-only, screen-reader and touch users. Delete chat uses `hidden group-hover:flex`, so it is not even a Tab stop until hovered. Task More, routine Delete, skill Delete and memory Forget remain opacity 0 when reached by Tab; the focus shadow is invisible with them. Task More does open and Escape correctly returns focus, but the trigger is invisible. Shared IconButton and ordinary visible buttons do have keyboard focus shadows; this is a distinct hover-visibility defect.

**Exact proposal:** for sidebar deletion replace `hidden group-hover:flex` with `flex opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100`; for each `opacity-0 group-hover:opacity-100` action add `group-focus-within:opacity-100 focus-visible:opacity-100`. Add `[@media(hover:none)]:opacity-100` to those action classes, or keep them visible at all times. Change `aria-label="Delete chat"` to ``aria-label={`Delete chat: ${c.title}`}``, and Task More to ``aria-label={`Actions for ${task.title}`}``. Enlarge hit areas as in A11. Repeated generic “Delete”, “Forget” and “More” labels need their row name so screen-reader button lists distinguish them.

### A06 — High: minimum-window layouts hide task actions and approval details

**Where:** `screens/Tasks.tsx:65`, `:119`, `:151`; `screens/Settings.tsx:176`; `components/ApprovalCard.tsx:73`, `:79`, `:96`, `:102`, `:133`; `components/PaymentCard.tsx:32`, `:46`.

**Affected:** users at the minimum window size, users zooming text, and anyone reviewing a long recipient before approval. At 940px the 244px sidebar leaves 696px; Tasks forces four columns into the remaining padded space. Real demo task cards were 125px wide; their Open/Done actions needed 137px and overflowed. Five Model provider columns leave ~74px each with 53px text areas; “OpenRouter” needs ~75px and runs outside its tile. These ordinary layouts fit at 1600px. The normal note approval fits at both sizes, but synthetic long values reproduce clipping: short detail values have unconditional ellipsis, and long unbroken recipients/large amounts overflow the fixed side-by-side payment summary. PaymentCard separately truncates its payee with no reveal affordance.

**Exact proposal:**

- Tasks outer grid: replace `grid-cols-4` with `grid-cols-2 min-[1200px]:grid-cols-4 overflow-y-auto`; add `min-w-0` to each column section and `flex-wrap` to the task action row at `:151`. This keeps all four statuses reachable at 940×620.
- Model providers: replace `grid-cols-5` with `grid-cols-2 min-[1200px]:grid-cols-5`; add `min-w-0 break-words` to provider buttons. Use viewport `min-[1200px]` intentionally: this screen also has the 220px Settings nav.
- Approval summary at `:73`: replace `flex items-end justify-between gap-4` with `flex flex-wrap items-end justify-between gap-4`; add `min-w-0 max-w-full` to the amount wrapper, change its amount font class to `text-[clamp(28px,4vw,46px)] break-words`, and replace recipient `max-w-[50%]` with `min-w-0 max-w-full break-words` plus `style={{ overflowWrap: "anywhere" }}`. Keep amount before recipient in DOM.
- Replace the short-detail `dd` class at `:102` with `text-ink text-right selectable min-w-0 max-w-[70%] whitespace-normal break-words` and `style={{ overflowWrap: "anywhere" }}`. Replace the dotted-leader element with A09's CSS, so long values get the available width. Add `tabIndex={0}` and ``aria-label={`${d.label}: full value`}`` to the long, scrollable `dd` at `:96` so its existing 180px scroll area is explicitly keyboard reachable.
- Add `flex-wrap` to the approval button row at `:133`; add `max-w-full whitespace-normal h-auto min-h-9 py-2` to HoldButton when a large amount makes its label wider than the row.
- PaymentCard: add `flex-wrap` at `:32`; replace payee `truncate` at `:46` with `break-words` and `style={{ overflowWrap: "anywhere" }}`. Give the amount `max-w-full break-words` too.

The stress amount is synthetic ₹1,23,45,678.90 and the recipient is a fabricated unbroken identifier, not department or real payment data. Payment-card long payees and 200% text zoom were source-reviewed, not executed as complete checkout/zoom scenarios.

### A07 — Medium: slash popup ignores Escape and has no selection semantics

**Where:** `components/Composer.tsx:37`–`:78`, `:96`–`:110`. WCAG 4.1.2; Escape is also an expected dismissal convention.

**Affected:** keyboard and screen-reader users. ArrowUp/ArrowDown wrap and Enter selects correctly. Escape leaves the list open. Matching suggestions are ordinary buttons without listbox/option roles, expanded state, or an active-descendant connection. Tab and Shift+Tab both select a command, which surprises users trying to leave the field.

**Exact proposal:** add `const [slashDismissed, setSlashDismissed] = useState(false);`; make matches empty when it is true (include it in the memo dependencies), and reset it to false in textarea `onChange`. At the start of `onKeyDown` add `if (e.key === "Escape" && matches.length) { e.preventDefault(); setSlashDismissed(true); return; }`. Remove `e.key === "Tab" ||` from the selection condition so Tab/Shift+Tab follow ordinary focus order. Add a stable list ID with `useId()`, `role="listbox"` to the popup, and stable `id`, `role="option"`, `aria-selected={i === slashIdx}`, `tabIndex={-1}` to each suggestion. Expose `aria-controls`, `aria-activedescendant` (only while open), and `aria-autocomplete="list"` from the textarea. Give the textarea a persistent label such as `aria-label="Message RelayIt"` and connect `/ for skills; Enter sends; Shift+Enter adds a line` with `aria-describedby`. Verify the chosen multiline textbox/listbox pattern with the screen readers supported by the desktop app before shipping; a full ARIA combobox conversion is not assumed here.

### A08 — Medium: selected/expanded/current states are visual only

**Where:** `components/ui/index.tsx:243` (Segmented); `components/Sidebar.tsx:76`, `:103`, `:126`; `screens/Settings.tsx:30`, `:178`; `screens/Tasks.tsx:20`; `screens/Connections.tsx:202`; `screens/Activity.tsx:102`; `components/Steps.tsx:30`; `screens/Skills.tsx:117`; `screens/Routines.tsx:126`. WCAG 4.1.2.

**Affected:** screen-reader users. Segments are tabbable and activate with Enter/Space, but there is no selected state. Sidebar/current Settings section, provider choice, tool domain chips, schedule presets and collapsed disclosure buttons have the same problem. Activity rows without data are still focusable buttons that do nothing.

**Exact proposal:** add `aria-pressed={value === o.value}` to Segmented's button and `role="group" aria-label={label}` to its wrapper; add a required `label: string` prop and pass `"Activity filter"`, `"Connection type"`, and ```${t.name} tool permissions``` at its three call sites. Use independent pressed buttons, not fake tabs requiring an unimplemented roving tab stop. Add `aria-current={active ? "page" : undefined}` to sidebar/Settings nav buttons and recent chats, and `aria-pressed={provider === p.id}` to provider tiles. Add `aria-pressed={on}` to domain chips and `aria-pressed={cron === p.cron}` to schedule presets. Add `aria-expanded={open}` plus a stable `aria-controls` panel ID to CanWait, ServerRow, Activity Row and Steps (Steps uses `expanded`). For Activity rows with `!hasData`, render the summary as a `div` with the existing row class rather than an inactive button.

### A09 — Medium: approval definition list is invalid; card grouping is absent

**Where:** `components/ApprovalCard.tsx:42`, `:69`, `:91`–`:103`. WCAG 1.3.1. Axe reproduces `definition-list` in both themes.

**Affected:** screen-reader users reviewing an approval. Each `dl > div` may group `dt` and `dd`, but the additional dotted-leader `span` is invalid in that group. The whole card has no named region. The primary reading sequence is otherwise correct for money: title → amount → recipient → summary/details → buttons. Metadata (service, expiry) precedes the title. The non-money note correctly has no amount, rather than a fabricated ₹0.

**Exact proposal:** remove `<span className="dotted-leader" />` from inside `dl > div`. Put `className="approval-detail flex items-baseline gap-2 text-[13px]"` on that div and add:

```css
.approval-detail > dt::after {
  content: "";
  display: inline-block;
  width: 12px;
  margin-left: 8px;
  border-bottom: 1px dotted var(--border-strong);
}
```

Add `const titleId = useId();`, `role="region" aria-labelledby={titleId}` on the outer pending card and `id={titleId}` on its h3. Move the service/expiry metadata block after the title/amount/recipient in DOM if title-first reading is required literally. Do not use CSS order to make the visual and reading orders disagree. Use A12's heading-level proposal when changing the h3. Avoid wrapping action buttons in `role="status"` or making the entire interactive card atomic; use A04's announcement strategy.

### A10 — Medium: names and form instructions are missing or ambiguous

**Where:** `screens/Settings.tsx:391`, `:394`, `:397`, `:419`, `:422`, `:270`, `:99`, `:345`; `screens/Connections.tsx:406`, `:420`; `screens/Routines.tsx:131`; `screens/Onboarding.tsx:147`; `components/ui/index.tsx:93`; `components/PaymentCard.tsx:77`. WCAG 1.3.1, 3.3.2, 4.1.2.

**Affected:** screen-reader, speech-input and cognitive-access users. The two Brief & alerts switches and both Browser agent switches omit the Switch `label` prop. Extra-key passwords have no label even though the dialog has a title. “Get a key” repeats across providers. Some other fields rely only on placeholder text or a nearby div: time, spending range, memory category, cron, saved-place fields, Onboarding's first name and UTR. Browser fallback placeholder names are not persistent visible labels. Generic `Field` wraps a label, input, auxiliary buttons and hint together, so hint/action text can become part of an overlong accessible name; errors are not explicitly described or marked invalid.

**Exact proposal:**

- Pass `label="Morning brief on first open"`, `label="Desktop notifications"`, `label="Allow the browser agent"`, `label="Run in the background"` to the four Switch calls.
- Wrap the extra-key Input in `<Field label="API key">...</Field>`; use ``aria-label={`Get a ${l.label} key`}`` on its external-link button.
- Add `aria-label="Brief time"` to the time input; add a real `<label htmlFor="spending-limit">Per-action spending limit</label>` and `id="spending-limit" aria-valuetext={formatInr(cap ?? 2000)}` to the range. Give saved-place fields labels such as ``aria-label={`Place ${i + 1} label`}`` and ``aria-label={`Place ${i + 1} address`}``.
- Wrap the cron Input with `<Field label="Schedule (cron)">`; wrap Onboarding's name with `<Field label="Your first name">`; wrap UTR with `<Field label="UPI reference / UTR (optional)">`. Give memory category, topic and fact explicit Field labels, forwarding an ID/`aria-labelledby` to Select's Trigger.
- Refactor `Field` to use a wrapper `div`, a `<label htmlFor={id}>` (or a text element with ID when labelling a composite control), and a separate hint/error ID. Extend Input/Textarea/Select call sites with matching `id`, `aria-describedby`, and `aria-invalid={!!error}`. Keep Check/Replace/Remove outside a wrapping label. This requires updating call sites together, not only adding disconnected label text.

Icon-only buttons in the six basic views already have names; the missing names appear in these secondary states. ServiceMark and Logo are decorative and already `aria-hidden`; Lucide decorative icons do not need duplicate spoken labels. No blanket “label every SVG” change is proposed.

### A11 — Medium: small and cramped click targets

**Where:** `components/ui/index.tsx:188`; `screens/Connections.tsx:406`; `screens/Tasks.tsx:128`, `:20`; `components/Sidebar.tsx:116`; `components/Steps.tsx:30`; delete/forget buttons in A05.

**Affected:** users with tremor, touch input or coarse pointing devices. Measured sizes: switches 38×22px; Get a key 10.5×10.5px; task More 17.5×17.5px; Steps disclosure 18.75px tall; sidebar delete 17.5px square when shown. Tailwind's rem spacing is smaller than usual because root font size is 14px: `size-6` is only 21px and `h-7` is 24.5px. A simple `size-6` replacement does not meet this request. Some small inline targets may meet WCAG 2.2 spacing/inline exceptions; this report records the explicit product minimum, not a blanket WCAG 2.1 failure.

**Exact proposal:** use `min-w-[24px] min-h-[24px] inline-flex items-center justify-center` on icon actions and `min-h-[24px]` on text disclosures. For More use `size-[28px] p-1` instead of `p-0.5`, plus A05's visibility fix. Change sidebar delete to `size-[24px] top-1 right-1`. Change Switch Root to `h-[24px] w-[40px]` and Thumb translations to `translate-x-[3px] data-[state=checked]:translate-x-[19px]` (thumb stays 16px). Keep adjacent row actions separated by at least 4px. Recheck the actual box in Chrome instead of relying on Tailwind class names.

### A12 — Low: headings and route focus do not reliably identify the screen

**Where:** `screens/Chat.tsx:104`; `components/ApprovalCard.tsx:69`; `screens/Connections.tsx:83`; `screens/Settings.tsx:28`; `components/ui/index.tsx:172`, `:325`; `lib/router.ts`; `App.tsx:41`.

**Affected:** screen-reader and keyboard users navigating by headings. Today, Activity and Tasks have good h1→h2 sections. Populated Chat jumps h1→h3 for approval titles; empty Chat's h1 is blank while the meaningful question is h2. Connections jumps h1→h3 for Google before its h2 sections. Settings has two h1s (Settings plus Model/Profile). Multiple h1s or a heading-level skip alone is not automatically a WCAG failure, but these produce a confusing outline. Route changes generally keep focus on a sidebar button; Today/Chat additionally autofocus the composer. There is no skip-to-content link, so users must tab through navigation to reach other screens.

**Exact proposal:** use `detail.data?.conversation.title || "Chat"` in Chat's h1; make pending approval titles h2 (with the associated test locator updated). Make the Google card title h2, and use a non-heading styled div for the Settings nav title so each selected page has one h1. Let EmptyState accept `headingLevel: 2 | 3` and choose it based on surrounding sections. Add `<a href="#main-content" className="sr-only focus:not-sr-only ...">Skip to content</a>` before Sidebar, and `id="main-content" tabIndex={-1}` to main. Handle the skip link's click with focus on that main rather than overwriting the hash router. On sidebar route activation, focus the destination h1 with `tabIndex={-1}` after data/entry transition settles; avoid stealing focus on background updates and keep explicit new-chat composer focus. Add `aria-label="Primary"` / `aria-label="Settings"` to the two nav elements.

### A13 — Medium: JavaScript animation and smooth scrolling ignore reduced motion

**Where:** `styles/index.css:376`; `main.tsx:13`; `components/MessageView.tsx:119`; `screens/Chat.tsx:89`, `:134`; `components/Steps.tsx:37`; `components/ui/index.tsx:252`; `App.tsx:85` and other `motion.*` entry/layout animations.

**Affected:** users with vestibular disorders and motion sensitivity. The CSS reduced-motion query correctly reduces shimmer, ping, spin and transitions to 0.01ms. It does not stop Motion's JavaScript/WAAPI transforms or the indefinite logo pulse. Explicit JS `scrollTo({behavior:"smooth"})` still animates regardless of the CSS query. This fails the requested “everything respects prefers-reduced-motion” quality requirement. Continuous decorative scaling may also need assessment under 2.2.2; no claim of a flashing-content failure is made.

**Exact proposal:** import `MotionConfig` and wrap App in `<MotionConfig reducedMotion="user">...</MotionConfig>` in main.tsx. For indefinite pulses in LiveRunView and Splash import `useReducedMotion`, then use `const reduce = useReducedMotion();` and `animate={reduce ? { scale: 1 } : { scale: [1, 1.06, 1] }}` (Splash preserves its existing error branch). Gate spring layout animations and height animations with the same flag if MotionConfig does not suppress those properties. In Thread, use `const reduce = useReducedMotion();`; change both scroll behaviours to `reduce ? "auto" : "smooth"` (retain the existing first-messages `auto` condition at `:89`). Add `scroll-behavior: auto !important` inside the CSS reduce query as a fallback. The suite verifies CSS suppression and reproduces the still-changing live logo transform; reduced-motion route/scroll behaviour needs rechecking after the proposal is applied.

### A14 — Medium: loading/failure is presented as empty/success, and Today discards failed input

**Where:** `screens/Today.tsx:25`–`:39`, `:45`, `:57`, `:113`; `screens/Chat.tsx:43`, `:109`; `screens/Tasks.tsx:47`, `:50`, `:81`; `screens/Activity.tsx:52`, `:78`; `screens/Connections.tsx:12`, `:38`, `:71`; `screens/Settings.tsx:146`–`:155`.

**Affected:** all users, especially screen-reader and cognitive-access users. Most queries turn `undefined` into an empty array, so while loading or on failure Today can claim “All quiet” / “Nothing needs you”, Tasks shows empty columns, and Connections/Activity omit content without explaining failure. Chat's failed initial detail fetch can look like a new empty conversation. Today's send/brief mutations have no error UI; Composer clears text immediately when submitted, so a failed create/send loses the prompt. Inbox sorting and some Settings mutations similarly have no visible error path. Model validation only handles `{ok:false}` responses, not thrown/network errors. These findings are primarily source review, not a claim that live external failures were exercised.

**Exact proposal:** gate each query's empty state behind `isSuccess`. Before dependent content, add e.g. `if (tasks.isPending) return <Page title="Tasks"><p role="status">Loading tasks…</p></Page>;` and `if (tasks.isError) return <Page title="Tasks"><p role="alert">Couldn't load tasks.</p><Button onClick={() => tasks.refetch()}>Try again</Button></Page>;`. Use the corresponding title/query for Activity and Connections; Today should show a section-level retry if one source fails rather than hiding all other sections. Add a Chat detail loading state and `role="alert"` retry state before its empty-conversation condition. Add `onError: (e) => setError(e instanceof ApiError ? e.message : "Couldn't check the model")` to Model's `check` mutation.

For Today, add an error state and a `ComposerHandle` ref. In `start.onError(error, submittedText)`, restore the ref's text with `composer.current?.setText(submittedText)`, set `Couldn't send that. Try again.`, and render it with `role="alert"` below the composer. Pass `ref={composer}`; clear the error on the next mutation. For `brief`/`triage`, render `mutation.error` beside the initiating control with a retry action; do not show “All quiet” as a substitute. Treat a nonempty Activity search with no results as `No matching activity` with a Clear search button instead of `Nothing here yet / As RelayIt works...`.

## Verified interaction results and limits

- Sidebar navigation, ordinary visible buttons/cards, named server switches, Radix selects and task popovers are keyboard reachable; slash arrow selection works. Standard dialog/select/popover Escape behaviour and focus return are exercised by the suite. The custom slash list and hover-only actions are the exceptions above. All six basic views have named interactive buttons in their initial state; secondary switches and password dialogs expose A10.
- Money short/full Enter and Space, repeated keydown, and the focus-leave case have separate checks. These are local demo approvals only. No department systems or real payment flows were used.
- The CSS reduced-motion override works. JavaScript pulse/scroll paths need the additional handling in A13.
- Core-level demo data populate Activity and Chat; Tasks additionally uses synthetic fixtures in all four statuses. The initial six-view probe ran with ordinary demo task data and observed the same narrow-column issue. The normal approval title/amount/recipient/detail/button DOM ordering was inspected; actual screen-reader speech was not tested.
- 940×620 and 1600×1000 geometry are checked per view. These checks catch intrinsic text overflow, not every overlap, all scroll positions, 200% zoom, localization or a native macOS webview. Long-recipient/amount stress testing is intentionally separate from normal flows.
- No desktop source fix is included. Proposed code is for the owner to apply and validate. The axe devDependency and its lockfile entry are the only dependency changes.

## Validation

Results are recorded after the final full-suite run below.
