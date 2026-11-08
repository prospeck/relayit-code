# RelayIt's voice: notes for the reviewer

`rewrites.json` holds 343 proposed strings, each with `en` and `hi`. They come from the 1,504 candidate keys: the 835 that
mention bot, Chief of Staff, Maus or Grok, plus the composer, chat.empty, onboarding, sidebar, routines, automations and
settings.general prefixes. The `relay.`, `onboarding.about.` and `onboarding.meet.demo` keys were skipped. A key is left
out when its English stays the same. No English value contains "Maus" any more, so nothing needed removing for it.

## Terms standardised

- **The assistant:** "your bots", "the bot", "this bot" and "Bot's screen" became "RelayIt" / "it" / "RelayIt's screen".
  Where a `{bot}` or `{name}` placeholder names the assistant, it stays and the rest of the sentence is fixed.
- **Composer jargon:**
  - "steer" → "add (to what it is doing)"
  - "queue" / "queued" → "send next" / "waiting"
  - "turn" → "what it is doing" / "once it is done"
  - "thread" → "chat" on ordinary screens
  - Hindi: रुका हुआ संदेश, चल रहे काम में जोड़ें, इसके बाद भेजें.
- **Hindi words:**
  - RelayIt takes masculine verbs.
  - routine = रूटीन inside routines.* (as hi.json already has), रोज़ का काम elsewhere (as relay.sidebar.routines has)
  - memory = याददाश्त; approval / your OK = मंज़ूरी
  - Settings paths use the Hindi screen label where hi.json has one.
- **Spelling:** British spelling (colour, summarise, labelled). "Organise" is never used: `src/locales/words.test.ts`
  fails on /organis/ in English.
- **Money:** nothing says RelayIt spends or pays. "Bots spend freely" became "AI use is not capped".
  onboarding.hint.approval now says RelayIt asks before anything that sends or spends.

## Decisions to check

1. **Advanced screens:** these keep "bot", because there it means one of several bots.
   - team*, teamShare, teamImport, orgLibrary, presetShare, templates
   - canvas*, map*, orgChart, owner
   - room.* / server.rooms.* / server.teammates.*
   - botAccess, vm, botIdentity, newBot
   - sidebar sections, bot menu, archived bots and group chats
   - composer.mention.*
   - bot pickers in routines and automations

   "Chief of Staff" stays as the name of the role there (`sidebar.bot.makeChief`, `chat.chiefOfStaff`, onboarding.chief.*,
   helperIntro.lead.chiefOfStaff), because "Make RelayIt" would not make sense. Only the marketing tone was cut
   ("Introducing your…", "Task me with anything").
2. **Per-bot panels say "RelayIt" in Advanced too.** These are the Screen panel, memory, calls, browser, skills, logins and
   keys strings (computer.*, place.*, memory.*, call.*, browser.*, skills.write.*). In Advanced they will say "RelayIt" even
   for another bot. Where neutral wording fitted, I used it instead:
   - model.*: "the usual model"
   - routines.runsOn.*: "Its own cloud desktop"
   - botSettings.replyStyle.*: "it"
3. **Labels other copy points at are kept**, so the pointers stay true:
   - `settings.section.computer` "Bot desktops" (`computer.err.vmOpenSettings` points at it)
   - `model.fallback.title` (`settings.recovery.ownBackups` points at it)
   - `routines.runsOn.boat` (checked by vocabulary.test)
   - `settings.followUp.steer` / `.queue`

   `settings.followUp.subtitle` now describes the two choices without quoting their labels. `chat.botScreen` became
   "RelayIt's screen", so `browser.notInstalled` now says "RelayIt's screen → Browser". Revert both together if that label
   stays.
4. **Guesses:**
   - `automations.newBox.noBots`: "Add RelayIt first, then come back here."
   - `app.loading.noBots`: "RelayIt isn't set up yet." I don't know when this state shows.
   - `needsYou.aBot`: the fallback name is now "RelayIt".
   - `routines.editor.botTask`: "Bot task" became "One task".
   - `apps.subtitle` drops "Then choose which bots may use it." Each bot still has its own switch in Advanced.
5. **Left alone on purpose:**
   - "Jev" in `composer.hint.auto` "Jev picks who responds" (and the decider/room keys) looks like an upstream name for the
     model that picks who answers. Please decide what it should say.
   - The Grok Bot import screens (`grokImport.*`, `grokFinish.*`, settings.import.grok*) name xAI's own product.
   - `onboarding.hosted.intro` and `onboarding.shared.body` describe a shared team Cloud, where several bots really are
     shared.
   - The settings.domain example addresses (`bots.example.com`) match `CustomDomainSettings.tsx` and its test.
   - `settings.pinnedCircles.subtitle` only loses "like Grok Bot".
6. **Hindi word order:**
   - server.incidents.* put `{where}` first, because the Hindi `where` strings are "… में" phrases. Please read them
     together with those strings.
   - `automations.app.labeled` is a fragment, so its Hindi word order is a best guess.
7. **Tests outside src/locales hard-code the old English** (run with the rewrites applied):
   - `src/lib/call-mode.test.ts` (call.live.disclosure*)
   - `src/lib/local-computer.test.ts` (computer.problem.localWindows / localWaylandBlocked / localNeedsApp)
   - `src/components/SettingsModal.appearance.test.ts` ("like Grok Bot", "Rooms keep the neutral bubble")

   They need updating in the same change that applies these strings. Four more files that use changed keys
   (BrowserPanel, ChatView.reactions, ComputerPanel.focus, limit-resets) fail to load on this machine even without the
   rewrites ("Cannot bundle built-in module node:sqlite"), so I could not check them.

## Check output

The checker is a Python script, not committed. For every entry it checks that:

- the key exists in `en.json` and is not protected;
- `en` and `hi` are non-empty strings;
- the set of `{…}` placeholders in `en` and in `hi` equals the original English's set;
- the order matches `en.json`;
- the locale tests' word rules hold.

Final output:

```
docs/relayit-voice/rewrites.json: 343 entries checked
FAILURES: 0
```

With the rewrites applied to `src/locales/en.json` and `hi.json` (both restored afterwards with `git checkout src/locales`),
`pnpm exec vitest run src/locales` gave: `Test Files 9 passed (9)`, `Tests 26 passed | 3 todo (29)`.
