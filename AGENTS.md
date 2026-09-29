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
Mirror from `main`: <https://ceneka.github.io/nova/> (see Deployment)

## Layout

```
index.html          markup for every screen and modal; inline onclick handlers
converter.html      standalone tool, unrelated to the app runtime
manifest.webmanifest  install metadata; every path relative, see Installing
sw.js               service worker: precache + offline. Hand-written, see Installing
icons/              PWA icon set; *.svg are the sources for tools/make-icons.sh
tools/make-icons.sh regenerates icons/*.png. Not part of the build
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
| 3 | drop | -10 (right) .. 10 (left); **lateral placement** |
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
  Statistics and closes itself too — one keypress, both screens.

`--danger` is a *fill* colour and text on it is `--on-accent`, not white —
white is 3.9:1 on the danger red. Destructive **labels** use `--danger-ink`,
which is a lighter red that does clear AA as text. See Design.

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
- **Every path in the manifest is relative** (`./`, `icons/...`). GitHub Pages
  serves this from `/nova/`, and an absolute `start_url` would launch the
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
precaches 33 files, and the app boots with the network switched off.) So
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
  `nova_ball_presets`, `nova_sessions`, `nova_active_session`, `nova_lang`.
  `factoryReset()` wipes all of them (it calls `localStorage.clear()`; the key
  list here is documentation, not a second implementation).
- **Styling**: CSS custom properties (`--primary`, `--surface`, `--danger`,
  …) so all four themes work for free. Never hardcode a colour in JS — see
  Design for the tokens and the rules behind them.
- **Modals** all share `.modal-overlay` at `z-index: 200`; a nested modal must
  appear **later in `index.html`** to stack on top. Toasts are `z-index: 300`.
- **The hamburger menu carries only drill actions** (download / export /
  import drills, Settings, About). Anything that is not an action you reach
  for mid-session belongs in the Settings screen (`js/settingsUi.js`), which is
  a full screen at `z-index: 150` — deliberately *below* the modals, so the
  preset sheet still opens over it. Add new settings there, not to the menu.
- `setTheme(name, { closeMenu = true })` — pass `closeMenu: false` when the
  caller is Settings, which must stay open so themes can be compared.
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

`.github/workflows/pages.yml` publishes to GitHub Pages on every push to
`main`. There is no build step, so the "build" job copies files and that is
deliberate — see the top of this file.

**What ships**: `index.html`, `css/`, `js/`, `images/`, `icons/`, `fonts/`,
`manifest.webmanifest`, `sw.js`, `converter.html`, `nova_drills_v2_example.csv`,
`README.md`. `sw.js` and the manifest are not optional extras - without them
the site still works in a tab but can never be installed and never opens
offline, which is most of what it is for. `fonts/` is not optional either: it
is precached, and a shipped-but-empty `fonts/` silently leaves the app on the
system font stack.

**What does not**, and why — extend this list rather than reverting to "copy
the whole repo":

| Excluded | Reason |
| --- | --- |
| `tests/` | development only; it stubs the page chrome the app expects |
| `1.3/` | a frozen older release, would publish a second stale app at `/1.3/` |
| `tools/` | the icon regeneration script; the PNGs it writes are committed |
| `AGENTS.md` | instructions for coding agents, not for users |

Two gates run before anything is deployed: `node --test tests/presets.test.mjs`
and the browser checks in `tests/integration.html`, driven through
headless Chrome in the same way as documented below. A failure blocks the
deploy.

The workflow also verifies that every local `src=`/`href=` in `index.html`
resolves to a file that was actually copied. That is the check that catches
"added a new module and forgot to copy the directory".

**One manual step after the first push:** repo Settings -> Pages -> Build and
deployment -> Source must be set to **GitHub Actions**. The workflow cannot do
this itself.

**The share-code feature does not belong to this repo.** `js/cloud.js` points
at `https://nova.varandal.de/api/...`, the original author's PocketBase
instance. Anyone using this deployment uploads and downloads drills through
that third-party server. If you want your own, self-host PocketBase and change
`API_URL`.

## Tests

```bash
node --test tests/presets.test.mjs      # 24 unit tests, no dependencies
```

Browser integration (329 checks, needs the HTTP server above):

```bash
google-chrome --headless --disable-gpu --window-size=430,932 \
  --virtual-time-budget=12000 --dump-dom http://127.0.0.1:8123/tests/integration.html \
  | grep -o '<title>[^<]*'        # -> <title>PASS(329) or FAIL(n)
```

Give it a throwaway `--user-data-dir`. The page drives the real importer and
the real editor, both of which write to `localStorage`, so a second run
against a warm profile starts from the previous run's drills and fails checks
that have nothing to do with the change.

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
