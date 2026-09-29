# AGENTS.md

Guidance for working in this repository. Read this before changing anything.

## What this is

A **static web client** for the Nova S Pro table tennis robot. No build step, no
package manager, no framework, no server. It talks to the robot over Bluetooth
Web Bluetooth API and keeps all user data in `localStorage`.

**Do not add a build step, a bundler, or npm dependencies.** The whole app is
`index.html` + `css/style.css` + plain ES modules loaded directly by the
browser. Adding tooling would break the "download the files and host them
anywhere" property that is the point of this project.

## Running it

ES modules need HTTP; `file://` will not work.

```bash
python3 -m http.server 8123 --bind 127.0.0.1
# open http://127.0.0.1:8123/
```

Deployed: <https://nova.tenisdemesa.ar/> — the published app.
This repository's own deployment is Cloudflare Pages, built from `main` (see
Deployment). There is no working GitHub Pages mirror: it was configured once
and never published to, and the workflow that would have done it is gone.

## Layout

```
index.html          markup for every screen and modal; inline onclick handlers
converter.html      standalone tool, unrelated to the app runtime
manifest.webmanifest  install metadata; every path relative, see Installing
sw.js               service worker: precache + offline. Hand-written, see Installing
icons/              PWA icon set; *.svg are the sources for tools/make-icons.sh
tools/make-icons.sh regenerates icons/*.png. Not part of the build
tools/prepare-site.sh copies the publishable site into _site/, and is both
#   Cloudflare's build command and the ci.yml site job
tools/run-checks.sh both test gates in one command
tools/check-app.mjs boots the real index.html over CDP
tools/screenshots.mjs regenerates images/*.png for the README
tools/live-check.mjs one live call against a real endpoint, BYOK
#   check-app.mjs also audits all 11 screens, at two widths, for boxes
#   that reach past the edge of the screen
css/style.css       all styling, one file, CSS custom properties per theme
fonts/              self-hosted DM Sans + JetBrains Mono woff2, see Design
js/
  main.js           entry point (loaded by index.html); wires window.* bindings
  state.js          app state + localStorage + drill CSV import/export
  constants.js      factory drills, physics constants, BLE identifiers
  ball.js           the ball array: layout, RPM maths, limits   <- read this
  presets.js        ball preset model, expansion, file formats   <- read this
  presetUi.js       preset picker + preset editor UI
  stats.js          training history: session log + selectors    <- read this
  statsUi.js        the statistics screen
  settingsUi.js     full-screen settings view (themes, presets, data)
  pwa.js           service worker registration, install prompt, theme colour
  editor.js         drill editor: renders ball cards, handles edits
  runner.js         plays a drill over Bluetooth
  ui.js             drill lists, tabs, drag-and-drop, session summary
  bluetooth.js      Web Bluetooth + the wire packet format
  cloud.js          share-code upload/download
  i18n.js           translation runtime: t(), applyI18n(), language state
  aiTerms.js        the assistant's vocabulary + parseUtterance()  <- read this
  aiMatch.js        deterministic preset matching
  aiCompile.js      intent + preset -> real steps, via makeBall()
  aiStore.js        nova_ai_drills, the IA category, and the draft
  aiConfig.js       BYOK storage, endpoint building, key redaction
  aiClient.js       OpenAI-compatible transport + the bounded agent loop
  aiAgent.js        the tools the model may call
  aiVoice.js        speech in/out, the wake word, the screen lock
  aiUi.js           the assistant panel
  locales/
    en.js           English dictionary, and the source of truth for the keys
    es.js           Español
  utils.js          toast, log, clamp, MD5, the drill-name fold
tests/              node unit tests + a browser integration page
1.3/                archived older version, do not edit
```

## The ball array — the single most important thing to understand

Everything (localStorage, the CSV export, the Bluetooth packet, the editor)
speaks the same flat array. Defined in `js/ball.js` as `B`:

| idx | field | notes |
| --- | --- | --- |
| 0 | top motor RPM | derived from speed/spin |
| 1 | bottom motor RPM | derived from speed/spin |
| 2 | height | -50 (down) .. 100 (up) |
| 3 | drop | -10 (backhand) .. 10 (forehand); **lateral placement** |
| 4 | frequency | 0 (30 bpm) .. 100 (90 bpm) — *not* bpm |
| 5 | reps | 1 .. 200 |
| 6 | active | 1 = played, 0 = skipped. **undefined means 1** |
| 7 | speed | 0 .. 10, editor-facing |
| 8 | spin | 0 .. 10, editor-facing |
| 9 | type | `'top'` or `'back'` — the only non-numeric slot |
| 10 | scatter | +/- on the drop point, single-variant steps only |

Rules that have bitten people before:

- **`A[6] === undefined` means active, not inactive.** `runner.js`,
  `renderEditor()` and `normalizeBall()` all default to 1. Do not "fix" this
  to a plain truthiness check.
- **Indexes 7-9 are optional.** The factory drills in `constants.js` store raw
  RPMs only; `normalizeBall()` reverse-calculates speed/spin/type on first
  read. Older `localStorage` data is the same.
- **Drop and scatter share 20 units.** `abs(drop) + scatter <= 10`, enforced by
  `maxScatterFor()`.
- **Spin is capped by speed** via `SPIN_LIMITS` — at speed 10 the table takes
  no spin at all. Always clamp through `maxSpinFor()` / `normalizeSpin()`.
- **A drill level is `Array<step>`; a step is `Array<ball>`.** More than one
  ball in a step = variants, and the runner picks one at random per
  repetition. Steps are the user-visible "Ball 1, Ball 2, ..." in the editor.

Do the maths in `js/ball.js` (`calculateRPMs`, `makeBall`, `normalizeBall`).
It used to be copy-pasted into three modules; that is why there is one now.

## Ball presets

A preset is a named ball recipe plus up to two variation axes:

- `placements` → lateral position, writes the **drop**
- `depths` → how deep it lands, writes the **height**

`buildPresetBalls()` takes the cross-product (placement is the inner loop, so
the order reads BH → Center → FH within each depth). An empty axis falls back
to the preset's own `drop`/`height`, so a preset always yields >= 1 ball.

The editor inserts them three ways, see `insertPresetIntoDrill()` in
`editor.js`:

- `single` — 1 step, 1 ball
- `variants` — 1 step holding every combination (random pick per repetition)
- `sequence` — one step per combination, in order

Placement labels are **from the receiver's point of view**, right-handed
receiver, matching the app's own factory convention (`push(b)` is drop -5,
`push(f)` is drop +5). The default three come from `standardPlacements(0)` and
`standardDepths(50)`, which re-anchor on whatever drop/height you are editing
rather than snapping back to fixed values.

`MAX_STEPS_PER_DRILL` (20) is enforced on insert only — the manual "+" button
in the editor is not capped, as before.

## Training history

`nova_stats` is two lifetime counters and always was. `js/stats.js` adds a log
of **sessions** on top of it, and `js/statsUi.js` renders the statistics
screen.

**A session is one robot connection**: handshake completes → link drops. Every
drill started in between folds into that one entry, so the history reads as
"14 drills last Tuesday" rather than 14 near-identical rows. `bluetooth.js`
opens the session on handshake-ready and seals it in `onDisconnect()`, which is
the single funnel for both expected and unexpected disconnects.

Rules that have bitten people before:

- **The open session is written to `nova_active_session` on every drill**, not
  held in memory. A reload, a crash or a phone locking mid-session must not
  lose the training that actually happened; `initStats()` seals anything left
  open on the next start, ending it at `lastActivity` so a tab left shut
  overnight does not read as an all-nighter.
- **Session ids are not `Date.now()`.** Disconnect/reconnect inside one
  millisecond produced two sessions with the same id, and `deleteSession()`
  then deleted *both*. `nextId()` nudges the id forward instead. There is a
  check for this; it was a real bug.
- **Nothing in `stats.js` throws.** Stats are the least important data the app
  holds, so a full or hand-edited `localStorage` costs the history and nothing
  else. It must never break a drill run.
- **Every entry is treated as hostile input.** `normalize()` drops records
  without a numeric `startedAt` and clamps a negative drill count.
- **The totals, the chart and the ranking are all derived** from the stored
  log on every render (`getTotals`, `getDailySeries`, `getDrillRanking`). Do
  not cache or denormalise them: deleting one session has to move the totals
  and the ranking too, and a second copy of the numbers is how that breaks.
- `MAX_SESSIONS` (500) is ~100 KB, deliberately a fraction of the ~5 MB
  budget that has to stay free for drills and presets.

`resetStats()` in `state.js` clears the counters **and** the history — one
"reset statistics", not two knobs that can disagree.

### The statistics screen

`#stats-view` is a full screen at `z-index: 160`: above Settings (150), below
modals (200), reached from a **row in Settings** rather than the hamburger
menu, per the rule that non-drill-action surfaces belong in Settings.

**It has two ways in, and they are not the same route.** The Settings row, and
the running totals in the footer of the drill list. `openStatsView(from)`
records which, and `applyBackLabel()` points the back button at whatever is
actually underneath — "Settings" from the row, "Drill" from the footer.
Closing needs no such care (it just uncovers whatever is there), but a button
labelled "Settings" sitting over the drill list promises a screen you cannot
get to from there. Set the `data-i18n` / `data-i18n-attr` keys as well as the
text: `applyI18n()` re-walks them on every language change, so an attribute
left pointing at the other key puts the wrong label back on the next switch.
Do not add a second Escape listener for the footer route — see below.

Two traps here, both of which cost a debugging round:

- **`openStatsView()` must remove `hidden`, `closeStatsView()` must put it
  back.** `.stats-view` declares no `display` of its own, so without the
  attribute it falls back to `display: block` and keeps covering the screen
  beneath. This is the same bug that hit `closeSettings()`.
- **Escape is handled in exactly one place, `settingsUi.js`.** It cannot live
  in `statsUi.js`: Settings *imports* that module, so a listener there is
  registered first, closes Statistics, and then Settings sees a closed
  Statistics and closes itself too — one keypress, both screens. The same goes
  for `aiUi.js`. The order in that one handler **is** the z-order: assistant
  170, Statistics 160, Settings 150.

`--danger` is a *fill* colour and text on it is `--on-accent`, not white —
white is 3.9:1 on the danger red. Destructive **labels** use `--danger-ink`,
which is a lighter red that does clear AA as text. See Design.

## The AI assistant ("Coach")

A voice-first assistant that turns a spoken sentence into a playable drill. It
is BYOK - no key ships, and **none is needed**: Tier 0 answers `push b, drive f`
on the device with no network at all. That is the whole reason it belongs in
this app rather than being a step backwards from it.

### The one architectural decision

**The model never writes ball numbers.** It writes an *intent* in the user's own
vocabulary, and the same two pure functions turn that into a real array whether
the intent came from the deterministic tier or from the model:

```
utterance ─▶ parseUtterance() ─▶ intent[] ─▶ matchPreset() ─▶ compile() ─▶ steps
              (deterministic)    (vocabulary)  (deterministic)   (deterministic)
                   │
                   └─ not understood ─▶ the model ─▶ intent[]  (same shape)
```

`compile()` never builds an array by hand - everything goes through
`makeBall()`, so `SPIN_LIMITS`, `maxScatterFor()` and the `active === 1` default
cannot be violated. Rules that have bitten people before:

- **Two tiers, and the cheap one is the floor.** Tier 0 needs no key, no
  network and no model. Tier 1 is only entered for what Tier 0 could not read,
  and a Tier 0 result is never a dead end - there is always a one-tap "ask the
  AI". The panel says which tier answered.
- **They cannot drift.** `aiTerms.js` holds the vocabulary once; the parser
  matches on it and `systemPrompt()` renders it into the model tier's prompt.
- **`aiTerms`, `aiMatch`, `aiCompile` and `aiClient` import cleanly under bare
  Node** - no `document`, no `window`, no `localStorage` at module scope, and
  `aiClient` takes its `fetch` **by injection**. That is what makes
  `tests/ai-client.test.mjs` possible with no browser and no network. Do not
  reach for a global in those four files.
- **"saque" and "push" are the same word here.** The factory key `push(b)` is
  labelled "Saque(Rev.)" in Spanish, but a serve and a rally push are opposite
  ends of the table. One vocabulary entry, two readings, and a fixed rule: a
  **depth word means serve**, no depth word means rally push. The speed
  difference (4.5 vs 1.5) is the point of telling them apart.
- **Intensity is a speed, never a scatter.** "fuerte" moves `speed` by at most
  +/-2. Scatter stays the explicit "con dispersion", so a drill can never
  surprise you mid-rally.
- **A connector only breaks where the next part names a shot.** "push b, drive
  f" is two steps; "a la derecha y fuerte" is one step with two modifiers. That
  rule is what makes the example sentence come out as three shots, not five.

### The rule that matters most in this feature

**Model output is untrusted input and is rendered with `textContent`, never
`innerHTML`.** This is the one place where the app's re-render-from-the-model
pattern becomes dangerous: everywhere else the model is the user's own drills
and presets, and here part of it is text from a remote server. No `innerHTML`,
no `insertAdjacentHTML`, no `data-i18n-html` on any node that can hold model
text, and no model string inside a template literal in a `render()`. `t()` does
not escape its parameters, so a dictionary value is trusted chrome and a model
value never goes through it.

**AI-generated names are the most hostile name source in the app.** The key is
`ai_` + the clock + a random suffix, *never* derived from the model's text - see
"Drill names are free text" below for why that is not a style preference. The
name itself is stored as typed and rendered with `textContent`.

### `nova_ai_drills` is its own key on purpose

It is not a `custom-ia` set inside `userCustomDrills`, because
`importCustomDrills()` rebuilds `custom_data` from scratch: AI drills there
would be **silently deleted by importing any CSV**, including one the user just
exported. It is also not in the shared drill CSV, whose column set is a
compatibility surface. The IA tab (`#view-ia`, `ui.js`) exists to keep "my
drills" and "the machine's drills" separable, with a one-tap **Move to Custom
A/B/C** - which is how an AI drill becomes permanently yours *and* CSV-
exportable, because from that moment it is an ordinary custom drill.

### The BYOK surface

Settings has an **AI assistant** section above Presets. Two slots, and
"same model for text and voice" is a **mode**, not a copy and not a shared
pointer - both of those have a failure mode. `voice.mode: 'follow-text'` resolves
the text slot at *call time* and the row shows what you are following with a
Detach button, so it can never silently change under you. No model id is
hardcoded; "Fetch model list" asks the endpoint and fills a `<datalist>`, while
the field stays free text for self-hosted proxies.

The key lives in `localStorage` under `nova_ai_config` and is sent **only** as
an `Authorization` header to the one base URL you typed. `redact()` exists
because that is a promise kept in more than one place, and a key in a console is
a key in a screenshot: **every** error path in `aiClient.js` scrubs the key it
*actually sent*, not only the stored one. There is a session-only option, and
the settings copy says out loud - in both languages - that `localStorage` is
readable by any script on the origin, which is fine on your own phone and not
fine on a shared machine.

### The tools, and what they deliberately cannot do

**No tool writes a ball array and no tool writes `currentDrills`.**
`persist_draft` is the single funnel into storage and it is the user's decision,
not the model's. A model that names a tool which does not exist has it reported
back rather than executed. `CONFIRM` in `aiAgent.js` is the one list of which
tools need a yes, so a tool cannot quietly become destructive by omission.
`delete_preset`, `update_preset` on a non-AI preset and clearing the IA category
all ask every time; playing a draft is deliberately free.

The loop is capped at **8 tool rounds and 45 seconds**, both abortable - a model
that calls a tool forever would otherwise hold a spinner forever. Streaming is
the default: a voice assistant that waits for the whole answer before it says
anything feels broken, so `readSse()` parses the stream by hand (~30 lines, no
SDK) and buffers across chunk boundaries, because a split in the middle of a
tool call's JSON otherwise loses the call silently.

### Two things only a live call finds

Both of these were found against a real endpoint and are now unit-tested, but
they are worth knowing before you "simplify" either one away:

- **`max_tokens` is a THINKING budget, not a reply budget.** Since ~2025 a lot
  of models behind an OpenAI-compatible endpoint are reasoning models, and they
  emit `reasoning` deltas *alongside* `content` deltas that are present but
  **empty**. The first live turn against `deepseek/deepseek-v4.1-flash`
  reported `completion_tokens: 700, reasoning_tokens: 700,
  finish_reason: "length"` and returned **no content and no tool call at all** -
  so the user got a silent empty bubble that looked exactly like a model with
  nothing to say. Hence `DEFAULT_MAX_TOKENS = 2048`, and a hard check: a turn
  cut off with nothing to show is retried once at double the budget and then
  **fails loudly** rather than returning an empty string.
- **The API speech-in path has TWO wire formats, and picking the wrong one is
  a 404, not an error.** OpenAI's `/audio/transcriptions` takes
  `multipart/form-data` with a `file` part and must NOT set `Content-Type`
  (the browser adds the boundary). OpenRouter's takes `application/json` with
  base64 in `input_audio: {data, format}`. The shape is chosen by provider.
  Two corollaries: the JSON body **must be `JSON.stringify`'d** (a plain
  object handed to `fetch` gets coerced, and the endpoint answers "expected
  object, received array", which looks like a bad model id and is not one), and
  **OpenRouter does not list transcription models in `GET /models`** - that
  endpoint covers chat models only, so "it is not in the list" is not evidence
  a transcription model does not work.

### Voice

Browser `SpeechRecognition` by default (Chrome and Safari only, **not
Baseline, not Firefox** - and Chrome's engine is cloud-backed, so it does not
work offline, which is the opposite of everything else here). `phrases` is
seeded with the app's own vocabulary, which is the single biggest accuracy win
for exactly the words that trip it up. `speechSynthesis` for replies, with
barge-in: starting to talk cancels the answer mid-sentence.

**Neither the MCP browser nor headless Chrome has a microphone**, so the panel
*always* has a text field - not a send button that expands - and the recognition
object is built through one seam, `setRecognitionFactory()`. A microphone you
can miss is a microphone that gets abandoned. Live voice gets tested by a person,
on a phone, with real keys.

### The wake word, and why the screen lock is not a separate feature

`holdScreenLock()` and the wake word are the same feature. **Chrome suspends
`SpeechRecognition` when the page is hidden or the screen locks**, so a wake
word in a page with no screen lock is dead about fifteen seconds after you stop
touching it - which is exactly how long a phone takes to dim at a table. So:

- **The lock is taken while the panel is open and given back the moment it
  closes.** An app that leaves a phone awake by itself is a flat battery.
- **The lock is released BY the browser** whenever the page is hidden, so
  holding it is not a one-shot: `aiVoice.js` re-acquires on
  `visibilitychange`. Without that it works exactly once.
- **Turning the lock off turns the wake word off with it**, and the settings
  copy says so rather than letting somebody wonder.

Rules that have bitten people before:

- **Arming is a tap, and the state is visible in words.** One tap means "the
  microphone is open from now on"; tapping again closes it. Anything that makes
  you re-trigger the wake word by hand is not a wake word. An armed mic that is
  only signalled by a blinking icon is a mic somebody does not know is live, so
  there is a line of text under the composer saying so.
- **A wake phrase matches only at the START.** A wake word that fires mid
  sentence answers to *"dame un nova al medio"*. `matchWakePhrase()` is a pure
  function precisely so this is testable exhaustively without a microphone.
- **Match the phrase BEFORE stripping fillers, not after.** `hey` is both a
  filler *and* the first word of the shipped phrase "hey nova", so a
  strip-then-match matcher silently degraded every "hey nova" to "nova" and the
  specific phrase could never fire. Filler stripping is the fallback, capped at
  two words.
- **The remainder is handed back as the ORIGINAL tokens, not the folded ones.**
  Folding is lossy, and the transcript is the user's own words: returning
  "saque al reves" for something said as "saque al revés" is a small lie about
  what was heard.
- **The engine ending a session is the NORMAL path, not an error path.** Chrome
  stops continuous recognition on its own after a pause, so `arm()` restarts it
  on every `onend`. A permission refusal is the one case that disarms instead.
- **A wake word on its own means "I am here", not "do something"** - it is
  acknowledged and the assistant waits, rather than compiling an empty drill.

### AI drills count toward the training history

Yes, deliberately. A session is one robot connection and every drill folds into
it; a draft played from the panel goes through the same `noteSessionDrill()` a
saved drill does. Excluding it would make the history a lie about what you
actually did. `startSequence()` is what made this possible - it is the
in-memory entry point the assistant calls, and `startDrillSequence()` is now a
thin wrapper over it.

## Translations

English and Spanish. **No i18n library** — `js/i18n.js` is ~200 lines, because
the rule at the top of this file forbids npm and a build step, and an app you
download and host anywhere cannot carry a toolchain.

Three ways to reach a string:

| Where | How |
| --- | --- |
| `index.html` | `<span data-i18n="menu.settings">Settings</span>` |
| attributes | `data-i18n-attr="placeholder:preset.name;aria-label:a11y.back"` |
| code | `showToast(t('toast.drillDeleted'))` |

`applyI18n()` walks the first two; it runs in `main.js` before anything else
renders, and again on every `locale-changed`. The English text stays in
`index.html` so the page reads correctly even if the module never loads.

**The app's name is written in four places and nothing ties them together:**
`app.title` in *both* dictionaries, the `<title>` fallback text in
`index.html`, `manifest.webmanifest`'s `name`, and `settings.foot`. Change one
and the app is called something different in the tab, under its own icon, and
in its About box — so the suite asserts they all agree. `short_name` and the
`apple-mobile-web-app-title` are deliberately *not* the full name: a launcher
truncates them around 12 characters. The name is a brand, so it is identical
in `en.js` and `es.js` and must not be translated.

**`js/locales/en.js` is the source of truth for the key set.** A value is a
string, or `{one, other}` for anything that counts — English and Spanish share
the `n === 1` rule, so one split covers both. `t('key', { n, name })` fills
`{name}` holes and picks the plural form.

Rules that have bitten people before:

- **`t()` never throws.** A missing key falls back to English, then to the key
  itself, and warns once. A half-translated build must degrade to English
  words, not to a blank button.
- **`js/locales/es.js` must carry exactly the keys `en.js` has.** The
  integration suite walks both and fails the build on a gap. This is the whole
  point: a partial translation would otherwise ship silently.
- **Adding a locale file means editing `PRECACHE` in `sw.js` too**, or it 404s
  the first time the phone loses signal. The import-graph check catches it.
- **The `window.setLang` / `window.t` bindings are guarded by
  `typeof window !== 'undefined'`.** That guard is load-bearing:
  `tests/presets.test.mjs` imports `presets.js` under bare Node, and
  `presets.js` reaches `i18n.js` through `describePreset()`.
- **`switching language only redraws what is open.** `setLang()` fires
  `locale-changed`; `main.js` owns the drill list and connection card, and
  `settingsUi.js`, `statsUi.js`, `editor.js` and `presetUi.js` each listen for
  themselves. `editor.js` in particular is a `<div>`-heavy screen that stays
  open across the change.

### What is deliberately NOT translated

**Stored user data.** Drill names, preset names, preset axis labels and share
codes all round-trip through `localStorage`, the CSV export and the
share-code server. Translating them would make a file exported in Spanish
unreadable in English and would mean migrating data already on devices. So the
data stays as the user typed it and only the chrome around it moves. Two places
that needed care:

- **Factory drill keys are storage** — they are the `custom_drills` object
  keys and the `Set` column of the shared CSV. `drillDisplayName()` composes
  the *label* from tokens (`push(b)` → `Saque(Rev.)`) and returns custom keys
  verbatim. `ui.js`, `editor.js` and `statsUi.js` each used to have their own
  copy of this; they now share the one in `i18n.js`, which is why switching
  language re-labels all three at once. The suite asserts the English output
  is byte-for-byte what it always was, for all 30 factory drills.
- **Preset axis labels are stored inside the preset.** `standardPlacements()`
  and `standardDepths()` still write the canonical English `BH` / `Center` /
  `FH`, and `axisLabel()` translates them **for the read-only chips only** —
  never for the axis `<input>`, which writes back to the model on `oninput`
  and would otherwise rewrite a user's saved label to "Rev." on first
  keystroke.

**The language picker is in Settings**, not the hamburger menu, for the same
reason themes are: it is a setting, not a mid-session action. The first visit
picks the language from `navigator.languages`; any later choice is stored in
`nova_lang` and always wins, so a trip through an English browser cannot undo
it.

## Design

The visual system is [tenisdemesa.ar](https://tenisdemesa.ar)'s, so the app
and the site that introduces it read as one thing. A dark, low-chroma shell
with one bright neon accent, DM Sans for the interface and JetBrains Mono for
anything numeric, and micro-labels at ~10px uppercase with wide tracking.

`css/style.css` is the only stylesheet and it is hand-written. There is no
preprocessor, so a theme is a block of declarations and nothing else:

| Token | What it is |
| --- | --- |
| `--bg` / `--surface` / `--card-bg` / `--input-bg` | the four dark surfaces |
| `--text` / `--text-light` | body copy, muted labels |
| `--border` | the hairline everything is divided by |
| `--primary` | the neon accent, and the theme's identity |
| `--accent-fill` / `--accent-line` | the "this one is on" pill |
| `--on-accent` | text that sits **on** `--primary` or `--danger` |
| `--danger` / `--danger-ink` | destructive fill, and destructive text |
| `--spin-top` / `--spin-back` | topspin is amber, backspin is blue, in every theme |

Rules that have bitten people before:

- **All four themes are dark now**, and they share every neutral; only
  `--primary`, `--accent-fill` and `--accent-line` differ. The **ids** are
  unchanged (`standard`, `ocean`, `forest`, `night`) so a stored
  `nova_theme_pref` still resolves — the *look* changed, the key did not.
- **`--primary` and `--danger` are fills, not text colours.** Text on them is
  `--on-accent`, a near-black. White is 3.9:1 on the danger red, so a white
  label on a red button fails AA without looking wrong. This replaces the old
  note that `--danger` "falls under 4.5:1 as text in three of the four
  themes", which is now true of all four.
- **Never hardcode a colour in JS.** A hex in a template string pins one
  theme's value and silently stops following the other three. That is how
  topspin rendered blue in every theme for a while: `editor.js` and
  `presetUi.js` each wrote an inline `background` that disagreed with the
  stylesheet, and the inline one won. Colour the control from CSS
  (`.sc-opt:first-child` / `:last-child`) and let the template emit classes.
  `settingsUi.js`'s `THEMES` swatches are the one deliberate exception — they
  are a *picture* of a theme, not a themed value.
- **No text below 10px.** The micro-label floor is `0.65rem` (10.4px). The
  suite fails the build on any preset-UI text under 10px, and the app is read
  at a table.
- **The suite re-checks contrast in all four themes** for the preset and
  statistics screens, so a bad pair fails the build instead of shipping. It
  also enforces 32px minimum tap targets there and 40px in Statistics.
  Changes outside those two screens are not covered — check them by hand.

**Fonts are self-hosted under `fonts/`** — four `woff2` subsets, DM Sans and
JetBrains Mono, latin and latin-ext, both SIL OFL 1.1. They are committed and
precached by `sw.js` rather than pulled from a CDN because the whole point of
this app is working with no signal, and a webfont that only arrives over the
network falls back to the system stack at exactly the wrong moment. Adding a
weight means adding a file to `PRECACHE` too.

`converter.html` is standalone and has no `data-theme`, so it carries the
`standard` palette inline rather than reading `css/style.css`. It is a copy,
not a shared import — if you change a token, change it there too.

## Installing (PWA)

The app installs to the home screen and runs offline. Four files, and the
rules that go with them:

- `manifest.webmanifest`, `sw.js`, `icons/` and `js/pwa.js`. `js/pwa.js`
  registers the worker and owns the Install row that `settingsUi.js` renders;
  it imports nothing from the app, so the test page can load it on its own.
- **The worker is at the site root, the module is not.** `js/pwa.js` resolves
  it with `new URL('../sw.js', import.meta.url)`. A relative `'./sw.js'` looks
  right in `index.html` and silently looks for `/tests/sw.js` the moment
  anything in a subdirectory imports it.
- **`PRECACHE` in `sw.js` is a hand-maintained list and the integration suite
  walks the real import graph to check it.** This is the one that bites: a
  module missing from the list installs perfectly, opens perfectly, and then
  fails the first time the phone loses signal. Adding `js/foo.js` and
  importing it anywhere turns the check red until you add it. It has already
  caught `js/pwa.js` once.
- **Every path in the manifest is relative** (`./`, `icons/...`). The app is
  published under a path prefix, and an absolute `start_url` would launch the
  installed app at the domain root and 404.

Cross-origin requests are never answered or cached - `js/cloud.js` points at
someone else's PocketBase, and a cached "code not found" is worse than none.

`sw.js` self-updates: `VERSION` is the cache name, so a deploy installs a whole
new shell, `skipWaiting()` + `clients.claim()` mean it reaches an open page
rather than sitting in the waiting state until every tab is closed. Bump
`VERSION` by hand; nothing generates it.

### Testing the PWA, and two things that will waste an hour

A **real registration cannot be tested in the headless suite**: under
`--virtual-time-budget` a *successful* registration never settles and the page
hangs, while a failed one rejects immediately. (It is the virtual clock, not
headless - over CDP against a real browser the same worker activates,
precaches the whole shell, and the app boots with the network switched off.) So
`tests/integration.html` evaluates the real `sw.js` through `new Function` with
a fake `self`/`caches`/`Request`/`fetch` and drives its own `install`,
`activate` and `fetch` handlers. That covers the logic; the browser half is
what happens the first time anyone opens the app.

Two more headless traps in the same file, both of which hang rather than fail:

- `img.decode()` and `createImageBitmap()` never settle. Use an `img.onload`
  promise and draw that to a canvas.
- A navigation `Request` cannot be constructed - `mode: 'navigate'` is reserved
  for the browser - so the fake passes a plain `{method, mode, url}` as
  `event.request`.

The maskable icon is checked for real, by reading its pixels: a launcher may
crop 10% off every edge, so the artwork has to stay inside the middle 80% of
the canvas or it gets cut in half on a real home screen.


## Conventions

- **ES modules with relative paths, no extensions issue, no aliases.**
- **Handlers are exposed on `window`** because `index.html` uses inline
  `onclick="..."`. Keep new handlers consistent with their neighbours.
- **Cross-module talk goes through `CustomEvent`s on `document`**, not direct
  imports. `presetUi.js` and `editor.js` are deliberately decoupled this way
  (`preset-insert`, `drill-editor-state`, `presets-updated`, `drills-updated`,
  `connection-changed`, `stats-updated`) — keep it that way rather than adding
  an import cycle.
- **Storage keys**: `custom_drills`, `custom_data`, `drill_order`,
  `user_defaults`, `nova_stats`, `nova_theme_pref`, `nova_last_played`,
  `nova_ball_presets`, `nova_sessions`, `nova_active_session`, `nova_lang`,
  `nova_ai_drills`, `nova_ai_config`.
  `factoryReset()` wipes all of them (it calls `localStorage.clear()`; the key
  list here is documentation, not a second implementation).
- **Styling**: CSS custom properties (`--primary`, `--surface`, `--danger`,
  …) so all four themes work for free. Never hardcode a colour in JS — see
  Design for the tokens and the rules behind them.
- **Modals** all share `.modal-overlay` at `z-index: 200`; a nested modal must
  appear **later in `index.html`** to stack on top. Toasts are `z-index: 300`.
- **`#theme-menu` lives INSIDE `<header>`, and that is load-bearing.** The
  header is `position: sticky`, so it is the containing block for the
  absolutely-positioned dropdown and the menu follows the page down. It used to
  be a sibling of the header inside `.container`, which does not scroll — so
  `top: 58px` meant 58px from the top of the *document*, and scrolled down the
  menu opened ~170px above the viewport while the hamburger that opens it stayed
  on screen. Tapping it appeared to do nothing. The suite checks the real
  `index.html` for the relationship, and `tools/check-app.mjs` checks the
  geometry on the real page. Note `right: 30px` on `.theme-menu`: the header has
  a `-15px` margin and is therefore 30px wider than `.container`, and the menu
  has to be pushed back to keep its right edge on the same pixel.
- **The header title is the only thing in the flow; the two controls float.**
  The title stays genuinely centred and `.ai-open-wrap` is `position: absolute`
  over the header's right margin. Reserving a grid column for the buttons looks
  like the tidier fix and is not: `1fr auto 1fr` leaves the title 208px for
  219px of text at 430px, and 98px at 320px, so it clips at every width. The
  name therefore has a short form (`.brand-short`, below 460px) - the
  breakpoint is arithmetic, not taste: the clear space is `viewport/2 - 210px`,
  so under ~453px the full name and two 40px buttons cannot both fit. They
  overlapped by 7px on a 375px iPhone SE before this.
- **`box-sizing` is content-box here, and width + padding therefore overflows.**
  It is not global in this file, deliberately, and `.modal-overlay` already
  carries an explicit `box-sizing: border-box` with a comment saying why. The
  trap is any element with a width AND horizontal padding: it renders
  `padding` wider than it asked for, and the moment its parent is the viewport
  width the right-hand side is off-screen and unreachable. Found on a 430px
  phone, all of it invisible to `documentElement.scrollWidth` - the offending
  boxes are inside `position: fixed` overlays, which do not widen the document,
  so the document stayed an honest 430px while 32px of every settings row sat
  off screen:
  - `.settings-shell` **+32px** - Settings, Statistics and the assistant panel
  - `.about-site` **+30px** - the About box, clipped by `.modal`'s overflow
  - `#dl-code` and `#save-name` **up to 100px** - no width rule at all, so they
    took the UA default of ~20 characters, which at their inline 1.6rem and
    1.2rem font sizes is 350px and 262px inside a 255px modal
  - `.mode-switch` and `input[type=number]`, +8 and +4

  **The test that finds this class is an element RECT against the viewport**,
  per screen, in `tools/check-app.mjs` - not `scrollWidth`, which is blind to
  fixed overlays, and not a parent-relative comparison, which wrongly flags the
  full-bleed main header, which spans the viewport on purpose via negative
  margins. Eleven screens at two widths.
- **Settings is a list of `<details>` groups, not one column.** It had reached
  2.8 phone screens of 29 always-visible rows, and the AI section alone was
  sixteen flat siblings with nothing to say which four were the text model and
  which three were behaviour toggles. Each section is a native `<details>`
  with a 64px summary; two start open, the rest cost one row. Native rather
  than a div + class because it brings keyboard support, the open state in the
  a11y tree, and no JavaScript to keep working.
  Two rules that are load-bearing:
  - **The open state is read from the live DOM at the START of `renderSettings`,
    not from a `toggle` listener.** `toggle` is queued as a task, so after a
    click it has not run yet when the re-render that follows synchronously
    executes - the state was always one render stale and the group a user had
    just opened snapped shut. The suite checks this by opening a group that is
    NOT open by default; testing one of the two defaults proves nothing,
    because the `open` attribute restores it either way.
  - **Every closed group carries a live status note** ("8 in your library",
    "Not set up", "Ready offline"). A collapsed row you cannot read is just a
    row, and the list still has to be scannable.
  `.settings-section-title` is deliberately NOT reused for the summary -
  `statsUi.js` uses it too, and restyling it there would be an unasked-for
  change. Pixel claims are measured in `tools/check-app.mjs`, not the suite,
  because the harness page has no `<meta name="viewport">` and its inner height
  is not a phone's.
- **The hamburger menu carries only drill actions** (download / export /
  import drills, Settings, About). Anything that is not an action you reach
  for mid-session belongs in the Settings screen (`js/settingsUi.js`), which is
  a full screen at `z-index: 150` — deliberately *below* the modals, so the
  preset sheet still opens over it. Add new settings there, not to the menu.
- `setTheme(name, { closeMenu = true })` — pass `closeMenu: false` when the
  caller is Settings, which must stay open so themes can be compared.
- **The site is linked from every place that names it**, and every one of those
  is `target="_blank" rel="noopener noreferrer"`: the About box (`.about-site`),
  the header brand (`index.html`, `.brand-link`, styled to look like plain
  heading text because it sits in the app's own header), the Settings footer
  (`footHtml()` in `settingsUi.js`, which wraps the domain inside the one
  `settings.foot` dictionary value rather than rebuilding the line — that string
  is the fourth copy of the app name and the suite checks it), and the bottom of
  `converter.html`, which is a standalone page with no way back otherwise. The
  domain is never translated; it is a domain.
- Re-rendering is done by rebuilding `innerHTML` from the model, so **every
  input must write to the model on `input`/`change`** or its value is lost on
  the next render. This bit the preset name field once already.
- `onchange` (not `oninput`) for fields where typing must not re-render, e.g.
  anything accepting `-`.

## The shared drill CSV is a compatibility surface

`exportCustomDrills()` / `importCustomDrills()` in `state.js` produce a format
other apps consume. **Do not change the column set, the order, the `;`
separator, or the `Set;Ball;Name;Speed;Spin;Type;Height;Drop;BPM;Reps` header.**

Ball presets deliberately have their **own** JSON/CSV format
(`js/presets.js`) and their own rows in Settings, so neither can break the
other.
`tests/integration.html` asserts the drill export is byte-for-byte what the
pre-refactor code produced — if you touch it, that check is your canary.

One intentional behaviour change: the importer now clamps the BPM column to
30-90 (it previously stored out-of-range values that the editor clamped later
anyway). In-range values round-trip exactly.

## Drill names are free text; the key and the CSV are not

A drill name is **whatever the user typed** — accents, commas, emoji. There is
no character filter on it, and there must not be one added back: the name goes
into `localStorage`, into the UI through `textContent`, and into the share
payload as JSON, all of which carry UTF-8 fine. (This was not always true. The
name field rejected anything outside `[A-Za-z0-9.\-#[]><+() ]`, so "Saque
Rápido" was refused with a toast.)

Two downstream places need a plainer string, and `asciiSlug()` in `js/utils.js`
is the only thing allowed to produce one:

| Where | Why |
| --- | --- |
| the storage key, via `drillKeyName()` | `updateLastPlayedHighlight()` interpolates the key into `.btn-drill[data-key="${key}"]`, so a `"` or `]` in it throws a `SyntaxError` on the next render — not at the point of the mistake |
| the CSV `Name` column, via `asciiSlug(drill.name, 'Drill')` | other apps split the row on `;`, and the file has only ever carried ASCII names |

Rules that have bitten people before:

- **Every place that mints a `cust_...` key goes through `drillKeyName()`** —
  create, save-as, rename, the share-code download in `main.js` and the CSV
  importer. All five take a name from outside the app (a prompt, a downloaded
  payload, another app's file), so all five are hostile by default.
- **The character class in `asciiSlug()` is the old validator's, on purpose.**
  It is what makes the export byte-for-byte unchanged for every name that was
  legal before the filter was lifted. Widening it is a compatibility change to
  a shared file, and the suite says so out loud.
- **The stored `name` is never folded.** Only the key and the CSV column are.
  A folded name that comes back through an import is the export talking, not
  the app mangling your data.

## Deployment

The site is served by **Cloudflare Pages**, which builds from the branch
itself. Build command `tools/prepare-site.sh`, output directory `_site/`.
There is no build step - see the top of this file - so "build" here means
copy a curated subset of files, and that is deliberate.

**One script, two consumers.** `tools/prepare-site.sh` is both Cloudflare's
build command and the `site` job in `.github/workflows/ci.yml`, so the thing
CI checks is the thing that gets published rather than the checkout.

**What ships**: `index.html`, `css/`, `js/`, `images/`, `icons/`, `fonts/`,
`manifest.webmanifest`, `sw.js`, `converter.html`, `nova_drills_v2_example.csv`,
`README.md`. `sw.js` and the manifest are not optional extras - without them
the site still works in a tab but can never be installed and never opens
offline, which is most of what it is for. `fonts/` is not optional either: it
is precached, and a shipped-but-empty `fonts/` silently leaves the app on the
system font stack.

**What does not**, and why — extend the list in the script rather than
reverting it to "copy the whole repo":

| Excluded | Reason |
| --- | --- |
| `tests/` | development only; it stubs the page chrome the app expects |
| `1.3/` | a frozen older release, would publish a second stale app at `/1.3/` |
| `tools/` | this script and the icon regeneration; the PNGs it writes are committed |
| `AGENTS.md` | instructions for coding agents, not for users |

The script ends with the two checks that catch what a copy cannot: every
local `src=`/`href=` in `index.html` resolves to a file that was actually
copied (the "added a new module and forgot the directory" check), and every
entry in `sw.js`'s `PRECACHE` exists in the artifact. Both name the offending
file and exit non-zero, so a bad build fails instead of shipping a site that
opens fine online and dies the first time it is offline.

### The tests are not a deploy gate any more

They are `.github/workflows/ci.yml`, and they are the *only* thing that runs
them: Cloudflare publishes a branch that fails its tests, and nothing else in
this repository would notice. There is no build step, no bundler and no test
runner in production, so what these two commands catch is the export-format
regression, a half-translated dictionary, and a settings group that renders
empty — none of which breaks a page load, and therefore none of which
anything else would see. Keep them.

`node --test tests/*.test.mjs` (three suites - the preset engine, the
assistant's core, and the model tier against a fake endpoint; the live
counterpart is `tools/live-check.mjs`) and the browser checks in
`tests/integration.html`. `tools/run-checks.sh` runs both in one command and
starts the server if it is not already up.

**The share-code feature does not belong to this repo.** `js/cloud.js` points
at `https://nova.varandal.de/api/...`, the original author's PocketBase
instance. Anyone using this deployment uploads and downloads drills through
that third-party server. If you want your own, self-host PocketBase and change
`API_URL`.

## Tests

```bash
node --test tests/*.test.mjs            # 90 unit tests, no dependencies
# or, both gates plus the browser suite, in one command:
tools/run-checks.sh
```

Browser integration (505 checks, needs the HTTP server above):

```bash
google-chrome --headless --no-sandbox --disable-gpu --disable-dev-shm-usage \
  --window-size=430,932 --user-data-dir=$(mktemp -d) \
  --virtual-time-budget=20000 --dump-dom http://127.0.0.1:8123/tests/integration.html \
  | grep -o '<title>[^<]*'        # -> <title>PASS(n) or FAIL(n)
```

`--user-data-dir` must be throwaway. The page drives the real importer and the
real editor, both of which write to `localStorage`, so a second run against a
warm profile starts from the previous run's drills and fails checks that have
nothing to do with the change. `tools/run-checks.sh` gets this right for you:
it runs both gates, starts the server if it is not already up, and always uses
a fresh profile.

Open it in a normal browser to see each check. It drives the real editor, the
real importer, the real exporter, the real settings screen and the real
statistics screen; only the surrounding page chrome (the drill list, the menu)
is stubbed, because the app modules expect those ids to exist.

It also enforces the UI rules that are easy to break by eye: no horizontal
overflow, every control at least 32-40px tall, no icon relying on the SVG
default paint, and WCAG AA contrast for the preset and statistics UI in all
four themes.

The i18n block is the other half of it, and it is the part that stops a
translation rotting quietly: dictionary parity, every `data-i18n` key in the
real `index.html` resolving, every `{placeholder}` actually filled at a call
site, the English drill labels byte-identical to the pre-i18n output, and the
Settings screen genuinely redrawing in Spanish. Read the section on
Translations above before changing a string.

### Bluetooth is tested with a fake robot

`bluetooth.js` cannot be exercised with real hardware in CI, so
`tests/integration.html` installs a fake `navigator.bluetooth` whose robot
greets *while* `startNotifications()` is still pending, then walks the
auth handshake. It covers the happy path, the connect/handshake watchdogs, a
dismissed picker, a GATT failure, a device missing the write channel, and
rapid double-taps.

**Two ordering rules in `connectDevice()` are load-bearing.** Both were bugs
that presented as "nothing happens, click Connect again":

1. The `characteristicvaluechanged` listener is attached **before**
   `startNotifications()` is awaited. The robot pushes its serial the moment
   notifications switch on; a listener added after the await drops it.
2. `handshakeState` is set to `"handshake"` **before** `startNotifications()`.
   A packet handled while the state is still `"disconnected"` matches no
   branch and is thrown away.

`setConnectTimeouts()` exists so the watchdogs can be tested without a 10s
wait. Do not remove it as "test-only cruft".

## Things that look like bugs but are not

- The `1.3/` directory is a frozen old release. Ignore it.
- `converter.html` is standalone and shares no code with the app.
- `normalizeDrills()` in `state.js` exists to upgrade pre-v2 stored drills
  whose steps were flat arrays instead of arrays-of-arrays.
- The MD5 in `utils.js` is a minified vendored implementation, used only for
  the BLE handshake. Leave it.
- Drill buttons use a 600 ms long-press to open the editor; the `.dragging`
  class guards the click handler during drag-and-drop.
