# Nova Drill | Tenisdemesa.ar

A pretty web client for the Nova S Pro table tennis robot. 
This tool can be used as a replacement for the original app, removing the requirements for server connectivity and user login.

An independent, actively developed continuation of the original
[**olanga/nova**](https://github.com/olanga/nova). See
[Credits](#credits) and [What this fork adds](#what-this-fork-adds).

Repository: **[Ceneka/nova](https://github.com/Ceneka/nova)** · App:
**<https://nova.tenisdemesa.ar/>** · Introduced on
[tenisdemesa.ar/nova](https://tenisdemesa.ar/nova)

| Main | Editor | Countdown |
| :---: | :---: | :---: |
| <img src="./images/main.png" width="300"> | <img src="./images/editor.png" width="300"> | <img src="./images/countdown.png" width="300"> |

## Usage

**Online/Offline:**

  * Visit: <https://nova.tenisdemesa.ar/> (the published app)
  * Mirror: <https://ceneka.github.io/nova/> (deployed from `main` by GitHub Actions)
  * Self hosting: https is required

**Local:**

  * Download repository files and host locally (e.g., `python3 -m http.server`).

**Requirements:**

  * Chrome, Cromite or any other Chromium-based browser. iPhone is not supported as it uses Webkit browser engine.

## Install as an app

The site is a **Progressive Web App**. Open the menu → **Settings** →
**Install app**, or use your browser's own *Add to Home screen*.

Installed, it runs in its own window with no browser chrome, and **it works
with no internet connection at all** — the whole app is cached on the device
the first time you open it. That is the point at a table, where the wifi is
whatever the hall happens to have. Drills, presets and history still live in
`localStorage`, so installing changes nothing about your data.

A new version is picked up automatically on the next launch. Settings also
shows whether the offline copy is ready yet.

## Features

**General**

  * **Fully customizable drills** Add and remove drills and balls. Share, export and import settings.
  * **Data Persistence:** Settings and drills saved to browser local storage.
  * **Themes:** 4 options, all dark — one shared shell in four accent colours.
  * **Languages:** English and Spanish, switchable in Settings. The first visit follows your browser's language; after that the app remembers your choice.
  * **Settings screen:** themes, language, the preset library, training history, drill defaults and data resets live in one place, behind the menu.
  * **Statistics:** a stored history of every session you have trained, with totals, a 14-day chart, your most-played drills, and per-session delete.
  * **AI assistant:** say or type a drill in plain words and it builds one. Works with no key and no signal for the common commands; add your own model in Settings for everything else.
  * **Installable:** add it to the home screen and it opens like a normal app — no browser, and no signal needed.


**Drill Management**

  * **Edit & Create:** Modify pre-programmed drills or create custom ones (Groups A, B, C).
  * **Sharing:** Import/export via CSV or share online specific drills using codes.
  * **Randomization:** Randomize ball sequences or configure multiple variants of a single ball.
  * **Scatter:** Randomize drop point (DP) of a single ball. Configured DP +/- scatter value.
  * **Drag-and-Drop Management:** Easily reorder drill sequences or move drills between categories using drag-and-drop.
  * **Controls:** Set drill duration (time or repetitions), pause/stop, and countdown timers.
  * **Tap to skip:** Starting countdown timer can be skipped by tapping on it.<br>


**Editor Tools**

  * **Drill Editor:** Long-press drill button to access. Supports deletion, "save as", and testing entire sequences.
  * **Ball Editor:** Add/remove balls, adjust sequence, rename drills, and test single balls without saving.
  * **Ball Presets:** Library of named ball recipes ("Short under serve", "Fast drive", …). Add one into any drill with its placement and depth variations expanded, or save a ball you have tuned by hand as a new preset.


## Ball Presets

A preset is a named ball recipe plus up to two variation axes:

  * **Placement** (the Drop value) — where the ball goes sideways. Labelled from the receiver's point of view for a right-handed receiver, so backhand is a negative drop and forehand positive. The default set is **BH / Center / FH** at drop -5 / 0 / +5.
  * **Depth** (the Height value) — how far the ball carries. The default set is **Short / Mid / Long**.

Both axes are optional and fully editable: rename the labels, change the
values, add or remove rows, or leave one axis empty to pin that value.

The top of the drill editor has an "Add from preset" button, repeated at the
bottom of the list where you add balls. Each preset offers three ways in:

| Action | Result |
| --- | --- |
| **+ Ball** | One ball, exactly as configured in the preset. |
| **Variants** | One step holding every placement × depth combination. The robot picks one at random on each repetition. |
| **Sequence** | One step per combination, in order (Short→BH, Short→Center, Short→FH, Mid→BH, …). |

So "Short under serve" with the default axes becomes a 3 × 3 = 9 ball set, and
you can train the same serve to backhand, centre and forehand without touching
a single number.

A starter library of 8 serve and rally presets ships with the app; edit, rename
or delete any of them. Presets can be exported and imported as their own JSON
or CSV file (Settings → Presets) so a library can move between devices. This is
separate from the drill CSV below, which is unchanged and still shared with
other apps.

Presets are stored per browser in `localStorage`, and are not affected by
"Factory Reset" of drills alone.

## The AI assistant

Tap the microphone in the header, or just type. Either way you describe the
drill and the app builds it:

```
Saque corto a la derecha, cortado, luego cortado largo al revés
y luego un top al medio fuerte
```

  * "push b, drive f" → two steps
  * "3Push b" → one step, three repetitions
  * "loop f fuerte, push b suave" → two steps, one strong and one soft
  * "preset Safe push a la derecha" → that preset, by name

It reuses **your own presets** wherever one fits and tells you which, and says
plainly when it did not find one and made the ball up. You see the whole
drill before anything is saved, can play it straight away, and can open it in
the normal editor to tweak a ball by hand.

### It works without a key

That is the point. The commands above are parsed on your device by a
deterministic parser — no network, no account, no key, and nothing leaves the
phone. An API key is **optional** and only widens what it understands: add one
in **Settings → AI assistant** and anything the local parser cannot read goes
to your own model instead.

### Your key, your endpoint

Settings has two slots, a text model and a voice model, either pointing at any
OpenAI-compatible endpoint (OpenRouter, OpenAI, or your own). "Use the text
model for voice too" is a switch with a visible state — the row shows exactly
which model you are following, with a button to break the link.

  * The key is stored in this browser only and is sent **only** as an
    `Authorization` header to the one base URL you type. It never appears in a
    log, a toast, an export, an error message or a share code.
  * There is a **session-only** option that keeps it in memory and forgets it
    when the tab closes.
  * `localStorage` is readable by any script on the site, which is fine on your
    own phone and not fine on a shared machine. Use the session-only option
    there.

### The IA tab

Drills the assistant builds live in their own **IA** tab, separate from Custom
A/B/C. That is deliberate: importing a CSV cannot touch them, and they are not
in the exported drill file until you want them to be. Each row has a one-tap
**Move to A / B / C**, and from that moment it is an ordinary custom drill of
yours — editable, shareable and included in every export.

### Voice

Speaking and being spoken to are on by default, and the text field is always
there, because a microphone you can miss is a microphone that gets abandoned.
Browser speech recognition is Chrome and Safari only and is **cloud-backed, so
it does not work offline** — which is the opposite of everything else in this
app, and is exactly why the no-key parser above exists. Point the voice slot at
your own endpoint for a better model, or for Firefox.

Talking over the assistant cancels its reply, so you can interrupt it.

### "Hey Nova"

Turn on **Settings → AI assistant → Wake word** and the microphone stays open
while the assistant is on screen. Say *"hey nova"* and the rest of the sentence
is treated as the drill:

  * "hey nova, saque corto a la derecha" → one short serve to the forehand
  * "hey nova" on its own just wakes it up, and it waits for the drill

The wake phrases are yours to change — *"hey nova"*, *"ok nova"* and *"nova"*
ship as defaults, comma separated in Settings. Anything you say that does not
start with one of them is ignored, so it does not answer to half the room.

**Keep the screen on** is a separate switch, and it is on by default, because a
browser stops listening once the screen sleeps. A wake word without it is dead
about fifteen seconds after you stop touching the phone. It is given back the
moment you close the assistant, so it never leaves your phone awake by itself.

Being straight about the limits: this works while Nova is on screen. A browser
stops the microphone when the app is closed or the screen is off, so it is not a
hands-free wake word the way a smart speaker is — for that, keep the tab open.

## Custom Drills (CSV)

Drills can be imported via CSV. Each category (A, B, C) holds 100 drills; each drill holds 20 balls. Variant balls (pseudo-randomness) share the same ball number.

**CSV Format:** `Set;Ball;Name;Speed;Spin;Type;Height;Drop;BPM;Reps`

**Example:**

```csv
A;1;Drill A2;7.5;5;top;50;-5;60;1
A;2;Drill A2;7.5;5;back;50;-5;30;1
B;1;Drill B1;7.5;5;top;50;-5;60;1
B;1;Drill B1;7.5;5;back;50;5;60;1
```

## Technical Parameters

| Parameter | Description | Range | Step |
| :--- | :--- | :--- | :--- |
| **Spin type** |top/back | - | - |
| **Speed** | ball speed | 0 - 10 | 0.5 |
| **Spin** | ball spin | 0 - 10 | 0.5 |
| **Height** | Ball height | -50 (down) to 100 (up) | 1 |
| **Drop** | Drop point | -10 (right) to 10 (left) | 0.5 |
| **bpm** | balls/minute | 30 - 90 | 1 |
| **Reps** | Repetitions | 1 - 200 | 1 |


## What this fork adds

Work done here on top of the original, most of it driven by things the
upstream app could not do or did not get right:

  * **A new look** — the app now shares the visual system of [tenisdemesa.ar](https://tenisdemesa.ar): a dark, low-chroma shell with one bright neon accent, the same DM Sans / JetBrains Mono pairing and the same micro-label treatment. The four themes are now four accent hues over one shared set of surfaces rather than three light themes and one dark one, so the app and the site it ships inside read as one thing.
  * **Ball presets** — a library of named ball recipes dropped into any drill with placement and depth variations expanded, in their own JSON/CSV format so they cannot break the shared drill CSV.
  * **Settings as a full screen** — themes, language, presets, statistics and data resets moved out of the hamburger menu, which now carries only drill actions.
  * **Translations** — English and Spanish, with a hand-rolled i18n layer rather than a dependency, so the app still installs from a plain file download with no build step. Your drills, presets and shared CSV stay in the language you typed them in; only the interface around them is translated.
  * **Training history** — sessions logged per robot connection, with totals, a 14-day chart, a most-played ranking, and the ability to delete a single session or all of them.
  * **Fixes** — connecting silently doing nothing, the 20-drill category cap, the Settings back button, preset field overflow, and three identical-looking preset entry points in the editor.
  * **An AI assistant** — a spoken or typed sentence becomes a drill, in English or Spanish. The common commands are parsed on the device with no key, no account and no network; your own model is optional and only widens what it understands. Drills it builds live in their own tab until you move one into Custom A/B/C.
  * **Installable PWA** — a web manifest, a service worker and a real icon set, so the app installs to the home screen and opens offline.
  * **Continuous deployment** — pushing to `main` runs the test suites and publishes to GitHub Pages. There is still no build step.

The drill CSV format, the ball array and the Bluetooth packet format are
unchanged, so drills remain interchangeable with the original app.

## Credits

This project is an independent continuation of the original
[**olanga/nova**](https://github.com/olanga/nova) and is not affiliated with or
endorsed by its author. The drill CSV format documented above is theirs, and
is deliberately kept compatible.

Upstream documentation that still applies:

  * [Wiki — general information](https://github.com/olanga/nova/wiki/General-information)
  * [Wiki — Spinsight measurements with Nova S Pro](https://github.com/olanga/nova/wiki/Spinsight-measurements-with-Nova-S-Pro)

Spinsight measurements are based on findings by
[smee](https://github.com/smee/nova-s-custom-drills) and plunder.

The visual system — the palette, the type pairing, the micro-labels — is
[tenisdemesa.ar](https://tenisdemesa.ar)'s, so that the app looks like it
belongs on the site that introduces it.

## Design

The whole interface is built on CSS custom properties in `css/style.css`.
There is no preprocessor and no build step, so a theme is a block of
declarations and nothing else:

| Token | What it is |
| --- | --- |
| `--bg` / `--surface` / `--card-bg` / `--input-bg` | the four dark surfaces, darkest to lightest |
| `--text` / `--text-light` | body copy and muted labels |
| `--border` | the hairline everything is divided by |
| `--primary` | the neon accent, and the theme's identity |
| `--accent-fill` / `--accent-line` | the "this one is on" pill, the way the site draws it |
| `--on-accent` | text that sits **on** `--primary` or `--danger` |
| `--danger` / `--danger-ink` | destructive fill, and destructive text |
| `--spin-top` / `--spin-back` | topspin is amber, backspin is blue, in every theme |

Two rules that are easy to break by accident:

  * **`--primary` and `--danger` are fills.** Text on them is `--on-accent`,
    a near-black. White is only 3.9:1 on the danger red, so a white label on a
    red button fails AA without looking wrong.
  * **Never hardcode a colour in JS.** A hex in a template string pins one
    theme's value and silently stops following the other three. That is how
    topspin ended up blue in every theme for a while.

`tests/integration.html` re-checks contrast for the preset and statistics
screens in all four themes on every push, so a bad pair fails the build rather
than shipping.

### Fonts

DM Sans and JetBrains Mono, self-hosted under `fonts/` as four `woff2`
subsets (latin and latin-ext for each). Both are
[SIL Open Font License 1.1](https://openfontlicense.org/).

They are committed and served from the app rather than pulled from a CDN
deliberately: this app's whole reason for existing is working with no signal
at a table, and a webfont that only arrives over the network is a webfont
that falls back to the system stack at exactly the wrong moment. `sw.js`
precaches all four, so an installed copy is typed correctly offline too.

## Development

No build step — it is plain ES modules. Serve the folder over HTTP:

```bash
python3 -m http.server 8123
```

```bash
node --test tests/*.test.mjs              # unit tests, no dependencies
tools/run-checks.sh                       # both gates, one command
```

The PWA icons are committed like every other asset. `icons/*.svg` are the
sources; regenerate the PNGs with `tools/make-icons.sh` after editing one
(needs ImageMagick). `sw.js` is also hand-written, not generated — when you
add or remove a file the app loads, update its `PRECACHE` list. The integration
suite fails if you forget.

Pushing to `main` runs both suites and, if they pass, publishes to GitHub
Pages (`.github/workflows/pages.yml`). Nothing to build — the app is served
as-is.

The assistant's core (`aiTerms`, `aiMatch`, `aiCompile`, `aiClient`) imports
cleanly under bare Node and `aiClient` takes its `fetch` **by injection**, so
the whole model tier is tested against a fake endpoint with no browser, no
network and no key.

Browser integration checks: open `tests/integration.html` (the page title
turns into `PASS(n)` / `FAIL(n)`). See [AGENTS.md](AGENTS.md) for the
architecture, the ball-array layout and the conventions to follow.


