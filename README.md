# Nova S Pro Drill Control

A pretty web client for the Nova S Pro table tennis robot. 
This tool can be used as a replacement for the original app, removing the requirements for server connectivity and user login.

| Main | Editor | Countdown |
| :---: | :---: | :---: |
| <img src="./images/main.png" width="300"> | <img src="./images/editor.png" width="300"> | <img src="./images/countdown.png" width="300"> |

## Usage

**Online/Offline:**

  * Visit: [https://olanga.github.io/nova/](https://olanga.github.io/nova/)
  * Self hosting: https is required

**Local:**

  * Download repository files and host locally (e.g., `python3 -m http.server`).

**Requirements:**

  * Chrome, Cromite or any other Chromium-based browser. iPhone is not supported as it uses Webkit browser engine.

## Features

**General**

  * **Fully customizable drills** Add and remove drills and balls. Share, export and import settings.
  * **Data Persistence:** Settings and drills saved to browser local storage.
  * **Themes:** 4 options, including dark mode.
  * **Settings screen:** themes, the preset library, drill defaults and data resets live in one place, behind the menu.
  * **Stratistics:**  accumulated counters (total balls/drills).<br>


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

The editor header has a star button that opens the preset picker. Each preset
offers three ways in:

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
or CSV file (menu → Presets) so a library can move between devices. This is
separate from the drill CSV below, which is unchanged and still shared with
other apps.

Presets are stored per browser in `localStorage`, and are not affected by
"Factory Reset" of drills alone.

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


## Credits & Support

Additional informations: [Wiki](https://github.com/olanga/nova/wiki/General-information)

Spinsight measurements: [Wiki](https://github.com/olanga/nova/wiki/Spinsight-measurements-with-Nova-S-Pro)

Based on findings by [smee](https://github.com/smee/nova-s-custom-drills) and plunder.

[![ko-fi](https://ko-fi.com/img/githubbutton_sm.svg)](https://ko-fi.com/E1E21PUFEQ)

## Development

No build step — it is plain ES modules. Serve the folder over HTTP:

```bash
python3 -m http.server 8123
```

```bash
node --test tests/presets.test.mjs        # unit tests
```

Browser integration checks: open `tests/integration.html` (the page title
turns into `PASS(n)` / `FAIL(n)`). See [AGENTS.md](AGENTS.md) for the
architecture, the ball-array layout and the conventions to follow.


