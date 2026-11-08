# RelayIt design

RelayIt is one assistant you hand things to. Every part of the design says that.

## The idea: a relay

A request is a **relay**. You say it once; RelayIt runs the legs (**Find**, **Prepare**), hands the baton back to you for
**Your OK** only when something sends, books or spends, and then it is **Done**. You never chase it: when it needs you it
comes to you, and when it doesn't, it doesn't.

That is why the app has:

- **Today** as home, not a chat list. One box to say it in, your usuals, and every relay by where it stands: *your turn*
  first, then *on it*, then *done*.
- **Relays** in the sidebar, newest first, each with a marker: a coral dot when it waits on you, a turning ring while it
  works, an empty ring when it is done.
- **The legs** under a chat's header, so a glance tells you whether to wait or act.
- **Your OK** as a moment of its own. A purchase shows the amount in ₹ in large type, who it goes to and what is in it,
  and you hold the button to approve. A hold is deliberate; a stray click is not. Money never gets "always allow", and
  RelayIt never moves money: you pay in your own UPI app.

## The mark: Lane

A running track with one quarter left open and a runner in the gap. The track is a job going round; the gap is the one
moment it comes back to you; the runner is where it is now. On the launch screen the track draws itself and the runner
laps it once, then settles in the gap.

Geometry lives in `shared/brand-mark.ts`; every icon is rendered from it by `scripts/make-brand-icons.mjs`.

## Colour

| Token | Day | Night | Means |
| --- | --- | --- | --- |
| Signal coral | `#FF4F2E` | `#FF5A3A` | This needs you. The only bright colour in the app. |
| Ink | `#111111` | `#F4F4F1` | Words, and your own messages (solid, inverted). |
| Page | `#FFFFFF` | `#0F1211` | Where the work is. |
| Track | `#F4F4F1` | `#0B0D0C` | The sidebar and what RelayIt says. |
| Field green | `#0F7B5A` | `#34C38F` | Done, paid. |
| Crimson | `#B4123A` | `#FF5C7A` | Something went wrong. Never coral, so a problem never looks like a request. |

Coral carries black, not white (5.8:1, where white would be 3.3:1), so a coral button reads like a race bib. Swiggy and
Zomato own orange and red-coral as *fills*; RelayIt uses coral as a *signal* on white or near-black, never as a ground.
Both skins clear WCAG AA; `pnpm check:contrast` measures every pair.

## Type

- **Onest** for the interface: plain, friendly, very legible at 13–15 px.
- **Unbounded** for display only: the wordmark, a greeting, an amount in rupees.
- **Anek Devanagari** behind both, so Hindi is set as carefully as English.

All three are open fonts bundled with the app, so nothing loads from the internet.

## Voice

Plain, warm and short. Say what happens and who acts: "RelayIt asks before it sends anything." Use the person's world:
orders, bills, trains, UPI, ₹, "8 November". No jargon, no exclamation marks, no emoji. English and Hindi are written,
not machine-translated word by word.

## Habits

RelayIt earns a place in the day by being the fastest way to get a thing done and the calmest way to know what needs you:

- **Quick Relay**: ⌥ Space (Ctrl+Alt+Space on Windows) from anywhere opens Today with the cursor in the box.
- **Morning brief** at 8:00 and a **Sunday recap**: routines that only read, never send or pay.
- **Usuals**: a finished relay can be saved, and is one tap on Today next time.

## Advanced

Several assistants, rooms, a team map and per-bot settings stay available under Settings → Advanced. RelayIt's
everyday surfaces never show them.
