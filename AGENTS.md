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

Deployed version: <https://ceneka.github.io/nova/> (from `main`, see Deployment)

## Layout

```
index.html          markup for every screen and modal; inline onclick handlers
converter.html      standalone tool, unrelated to the app runtime
css/style.css       all styling, one file, CSS custom properties per theme
js/
  main.js           entry point (loaded by index.html); wires window.* bindings
  state.js          app state + localStorage + drill CSV import/export
  constants.js      factory drills, physics constants, BLE identifiers
  ball.js           the ball array: layout, RPM maths, limits   <- read this
  presets.js        ball preset model, expansion, file formats   <- read this
  presetUi.js       preset picker + preset editor UI
  settingsUi.js     full-screen settings view (themes, presets, data)
  editor.js         drill editor: renders ball cards, handles edits
  runner.js         plays a drill over Bluetooth
  ui.js             drill lists, tabs, drag-and-drop, session summary
  bluetooth.js      Web Bluetooth + the wire packet format
  cloud.js          share-code upload/download
  utils.js          toast, log, clamp, MD5
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
  `nova_ball_presets`. `factoryReset()` wipes all of them.
- **Styling**: CSS custom properties (`--primary`, `--surface`, `--danger`,
  …) so all four themes work for free. Never hardcode a colour in JS.
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

## Deployment

`.github/workflows/pages.yml` publishes to GitHub Pages on every push to
`main`. There is no build step, so the "build" job copies files and that is
deliberate — see the top of this file.

**What ships** (656 KB): `index.html`, `css/`, `js/`, `images/`,
`converter.html`, `nova_drills_v2_example.csv`, `README.md`.

**What does not**, and why — extend this list rather than reverting to "copy
the whole repo":

| Excluded | Reason |
| --- | --- |
| `tests/` | development only; it stubs the page chrome the app expects |
| `1.3/` | a frozen older release, would publish a second stale app at `/1.3/` |
| `AGENTS.md` | instructions for coding agents, not for users |

Two gates run before anything is deployed: `node --test tests/presets.test.mjs`
and the 120 browser checks in `tests/integration.html`, driven through
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

Browser integration (120 checks, needs the HTTP server above):

```bash
google-chrome --headless --disable-gpu --window-size=430,932 \
  --virtual-time-budget=12000 --dump-dom http://127.0.0.1:8123/tests/integration.html \
  | grep -o '<title>[^<]*'        # -> <title>PASS(120) or FAIL(n)
```

Open it in a normal browser to see each check. It drives the real editor, the
real importer, the real exporter and the real settings screen; only the
surrounding page chrome (the drill list, the menu) is stubbed, because the
app modules expect those ids to exist.

It also enforces the UI rules that are easy to break by eye: no horizontal
overflow, every control at least 32-40px tall, no icon relying on the SVG
default paint, and WCAG AA contrast for the preset UI in all four themes.

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
