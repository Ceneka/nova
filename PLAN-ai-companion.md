# Plan — "Coach", the AI companion for Nova

Status: **implemented.** All eight phases shipped; see `AGENTS.md` → *"The AI
assistant"* for the design as built. This file is kept as the design record —
the reasoning, the decisions and the alternatives — because most of it is still
the best explanation of *why* the code is shaped the way it is.

Three things in here turned out to be wrong, or wrong in a way the code could
not survive, and the code follows the correction rather than the plan:

  - **§14's claim that the voice model must come from `/models` was a bad
    inference.** OpenRouter does not list transcription models there at all, so
    "not in the list" says nothing. The endpoint works; `js/aiVoice.js` takes
    two different wire formats because OpenAI and OpenRouter genuinely differ.
  - **§5's compiler table needed a role for the rally push.** `serve` and `push`
    are one vocabulary entry with two readings, and the plan's own table already
    needed `push` as a distinct row. The disambiguation rule is in `aiTerms.js`.
  - **§16 open question 1 is answered in the code, not in this file:** Tier 0 is
    the floor, not a degraded fallback. It is the path that works with no key,
    no network and no model, which is the whole point in an app that runs at a
    table.

Two more things only a live call found, and which no amount of planning would
have: `max_tokens` is a *thinking* budget for reasoning models, and an API
speech-in endpoint is a **request shape**, not a URL. Both are written up in
`AGENTS.md` under *"Two things only a live call finds"*.

> ### A note on the survey this plan was written from
>
> The tree was dirty when this was drafted, with uncommitted work in
> `tests/integration.html`, `js/utils.js`, `js/state.js`, `js/ui.js`,
> `js/main.js`, `js/locales/*` and `AGENTS.md` — including a new section,
> *"Drill names are free text; the key and the CSV are not"*. That work was
> real and is now committed; §3.1 was written with it in mind. Line numbers
> here are volatile and were never meant to be followed.

---

## 0. What we are building

A voice-first (text as an equal citizen) assistant that turns a spoken sentence into a
playable drill:

> *"Saque corto a la derecha, cortado, luego cortado largo al revés y luego un top al medio fuerte"*

The assistant looks at **your** presets first, reuses the ones that fit, invents balls for
the ones that don't, shows you exactly what it built, plays it on request, and — **only if
you ask** — saves it into a new "IA" category that is separate from your own sets A/B/C.

Models are BYOK. Two slots in Settings (text + voice), each with a "use the same for both"
option. No key ships with the app.

---

## 1. The one architectural decision everything else hangs off

**The model never writes ball numbers.**

A drill step is a flat 11-slot array with three load-bearing constraints that an LLM will
get subtly wrong and that no amount of prompting reliably fixes:

- `active === undefined` means **on**, not off (`runner.js:42`, `normalizeBall`)
- spin is capped by speed through `SPIN_LIMITS` — at speed 10 the table takes no spin at all
- `abs(drop) + scatter <= 10` (`maxScatterFor`)
- factory drills store raw RPMs only; 7–9 are reverse-calculated on first read

So the pipeline is:

```
utterance ──▶ parseUtterance()  ──▶ intent[]  ──▶ matchPreset()  ──▶ compile()  ──▶ steps
              (deterministic)      (vocabulary)  (deterministic)  (deterministic)
                   │
                   └─ not understood ──▶ LLM ──▶ intent[]  (same shape, same downstream)
```

The model only ever emits **declarative intent in the user's own vocabulary**, and exactly
the same two pure functions turn that into the real array whether the intent came from Tier 0
or from the model. Three payoffs:

1. Invalid arrays become structurally impossible.
2. Both halves are testable in bare Node with no network (`node --test tests/ai.test.mjs`).
3. If the model is dumb, small, or offline, the path below still produces something sane —
   and with no model configured at all, that path is the *whole* path (§1.5).

### The intent object

```js
{
  role:      'serve' | 'drive' | 'loop' | 'block',             // "saque"/"push", "drive", "top"/"loop", "bloqueo"
  rotation:  'top' | 'back' | 'side' | 'flat',                 // "top", "cortado", "lateral"
  side:      'bh' | 'center' | 'fh',                           // "al revés"  |  "al medio"  |  "a la derecha"
  depth:     'short' | 'mid' | 'long',                         // "corto", "medio", "largo"
  intensity: 0..10,                                            // "fuerte" -> high, "suave" -> low
  bpm?: 30..90,
  reps?: 1..200,
  variants?: 'single' | 'variants' | 'sequence',
  note?: 'free text carried over from the sentence'
}
```

There is deliberately **no separate `push` role**: the app already equates the two — the
factory key `push(b)` is labelled **"Saque(Rev.)"** in Spanish (`en.js` `drill.stroke.push`
→ "Push", `es.js` → "Saque"). One role, two spellings, one dictionary.

The user sentence above becomes **three** intents, in order:
`{serve, back, short, fh, low}`, `{serve, back, long, bh, mid}`, `{loop, top, mid, center, high}`.

`side` uses the app's own vocabulary (`bh` / `center` / `fh`), which `axisLabel()` already
renders as **Rev. / Centro / Der.** in Spanish and **BH / Center / FH** in English — see §2
for why the sign is what it is.

---

## 1.5 Two tiers, because this app's whole identity is "works with no signal"

A feature that needs a network round-trip before it can answer `push b, drive f` is a step
backwards for this app. So there are **two tiers**, and the cheap one is not a degraded
fallback — it is the floor, and it ships first.

**Tier 0 — deterministic, always available, zero configuration.**
`parseUtterance()` in `aiTerms.js` walks the bilingual vocabulary table and matches
placeholders, strokes, sides, depths, intensities and counts. It handles the commands people
actually repeat at a table:

> *"push b, drive f"* → two steps
> *"3Push b"* → three repetitions of one step
> *"loop f fuerte, push b suave"* → two steps with intensity
> *"preset Safe push a la derecha"* → looked up by name in your own library

No key, no network, no model, no latency. ~200 lines, fully unit-tested, and it is the same
vocabulary table the model tier is given, so the two tiers cannot drift.

**Tier 1 — the model**, used when it is configured *and* Tier 0 did not fully understand the
sentence. The panel shows which tier answered, and a one-tap **"ask the AI"** on any Tier 0
result sends the same sentence up. Tier 0 is never a dead end and never a trap.

This also means the feature is shippable, testable and demonstrable before anyone types an
API key — which is the phase order in §15.

---

## 2. The `drop` sign — settle this before anything else, because I nearly got it wrong

Three sources in this repo disagree about which end of the `drop` axis is the right-hand
side, and only one of them is right.

**What the app actually does** (factory data in `constants.js:38-43`):

```
PUSH_B = [1547, 2915, 50, -5, …]   →  key "push(b)"  →  "Push (B)"  →  ES "Saque(Rev.)"
PUSH_F = [1547, 2915, 50,  5, …]   →  key "push(f)"  →  "Push (F)"  →  ES "Saque(Der.)"
```

**What the UI tells the user** (identical in both locales):

- `en.js` `preset.placementHint` — *"Named from the receiver's view, right-handed:
  **backhand is a negative drop, forehand positive**."*
- `es.js` `preset.placementHint` — *"…el **revés es un drop negativo** y **la derecha
  positivo**."*
- `es.js` `axis` — `bh: 'Rev.'`, `center: 'Centro'`, **`fh: 'Der.'`**

**What the comments say** — and this is the one that is wrong:

- `ball.js:13` — `drop  -10 (right) .. 10 (left)`
- `presets.js:13` — `(-10 right .. 10 left)`
- `AGENTS.md` (the ball-array table) — `-10 (right) .. 10 (left)`

Those three have the direction **flipped** relative to the factory data and the user-facing
copy. The truth, for a right-handed receiver:

| Spanish | App label | `drop` |
| --- | --- | --- |
| **la derecha** | `Der.` / FH | **positive** |
| **al medio** | `Centro` | 0 |
| **el revés** | `Rev.` / BH | **negative** |

Two things follow, and they are the reason this section exists:

1. **This is a live documentation bug and it goes in Phase 0.** Three comments and
   `AGENTS.md` need the direction corrected. A comment that contradicts the code is exactly
   how the next person — or the next model — gets it backwards.
2. **The assistant must reuse `axisLabel()`** (`i18n.js:236`), not invent its own words. When
   the app is in Spanish the user says *"a la derecha"* and hears and sees *"Der."*; in
   English they say *"forehand"* and see *"FH"*. One vocabulary, already translated, already
   tested.

### The rest of the honest limits

The ball array has exactly **two** placement axes: `drop` (lateral) and `height` (depth).
Two of the three things your sentence uses are not directly expressible:

| You said | The array has | How we handle it |
| --- | --- | --- |
| *"a la derecha"* / *"al revés"* | `drop` −10..10 | **Exact, and unambiguous.** They are the two ends of one axis — see above. |
| *"corto"* / *"largo"* | `height` −50..100 | **Proxy.** Short/long are serve-legality properties, not height. We map short→lower, long→higher, and when a matching preset exists **the preset's own height wins** — which is why `preset_short_under` (h=30) vs `preset_long_under` (h=55) is the real source of truth. `es.js` already says this out loud: *"Úsalo para sacar corto / medio / largo desde el mismo saque."* |
| a robot-side / table-half concept | **nothing** | The app has no such concept at all — not in the array, not in the factory drills, not in the presets. "Al revés" in this app's language means the receiver's backhand side, full stop. If you ever mean the robot's physical side, that is a new field *and* a firmware question, and it is out of scope here. |

Also: there is no "serve vs rally" flag anywhere in the model — it is only ever encoded in a
drill's *name*. So the assistant carries it as a `note`, not as data. I do **not** propose
changing the ball array or the CSV.

---

## 3. New data

### 3.1 `nova_ai_drills` — its own storage key, its own tab

```json
[{ "key": "ai_1724...", "name": "Saque corto + cortado largo",
   "steps": [[...],[...]], "createdAt": 1724, "source": "voice",
   "plan": [{ "intent": {...}, "presetId": "preset_short_under", "usedFallback": false }] }]
```

**Why a separate key and not a `custom-ia` set inside `userCustomDrills`:**

- `importCustomDrills()` (`state.js:144`) rebuilds `newCustomData` from scratch and
  overwrites `custom_data`. AI drills living in `custom-a` would be **silently deleted by
  importing any CSV**. A separate key cannot be hit by that.
- The shared CSV `Set;Ball;Name;…` column is a compatibility surface (`AGENTS.md`: do not
  change the column set). A new `IA` row value would break other consumers.
- `factoryReset()` is `localStorage.clear()`; a documented key is a documented casualty.
- You keep "my drills" and "the machine's drills" cleanly separable, with a bulk clear.

UI: a 7th tab `#view-ia`, `tab.ia` in both locales, added to the `tabs` array at
`ui.js:391`, and `grp-difficulty` hidden for it (`:404`). Each row gets an **AI** chip and a
source glyph (🎙 / ⌨). Plus **"Move to Custom A/B/C"**, which is how an AI drill becomes
yours permanently and becomes CSV-exportable.

> ### The name rule — the single most important line in this plan
>
> The updated `AGENTS.md` is explicit: **every place that mints a `cust_...` key goes
> through `drillKeyName()`**, because `ui.js:174` interpolates the key into
> `.btn-drill[data-key="${key}"]` and an unescaped `"` or `]` throws a `SyntaxError`
> on the *next* render, not at the point of the mistake.
>
> An AI-generated drill name is the most hostile name source this app will ever have:
> it is text from a third-party model, verbatim, with arbitrary punctuation. So:
>
> - the **key** is always `ai_` + `Date.now().toString(36)` + a random suffix —
>   **never** derived from the model's text;
> - the **display name** is stored as typed and rendered with `textContent`;
> - `asciiSlug(drill.name, 'Drill')` is used wherever a plainer string is needed
>   (CSV column, attribute interpolation), and nowhere else.
>
> This is not optional and it is not a style preference.

### 3.2 `origin: 'ai'` on presets

Additive only: `clonePreset` / `normalizePreset` / the JSON export carry it; the **preset CSV
header is untouched** (`Name;Id;Speed;…`). Only used for the badge in the preset sheet and
for "these are the ones the AI made" in the assistant's readout.

---

## 4. New modules (flat, to match the repo)

| File | Responsibility | May touch |
| --- | --- | --- |
| `js/aiConfig.js` | BYOK storage, endpoint building, provider presets, redaction | `localStorage` |
| `js/aiTerms.js` | the intent ontology, the bilingual vocabulary table, and `parseUtterance()` (**pure data + pure functions**) | nothing |
| `js/aiMatch.js` | `matchPreset(intent, presets)` — deterministic scoring | nothing |
| `js/aiCompile.js` | `compile(intent, match)` → `Array<step>` via `makeBall()` | `ball.js` only |
| `js/aiStore.js` | drafts (in-memory) + `nova_ai_drills` + preset CRUD wrappers | `localStorage` |
| `js/aiClient.js` | OpenAI-compatible fetch, tool loop, error mapping, budget caps | `fetch` (injected) |
| `js/aiVoice.js` | STT/TTS, both the browser and the API path | `SpeechRecognition`, `speechSynthesis`, `MediaRecorder` |
| `js/aiUi.js` | the panel, transcript, tool trace, draft preview, confirmations | DOM |

**Hard rule:** `aiTerms`, `aiMatch`, `aiCompile` and `aiClient` must import cleanly under
bare Node — no `document`, no `window` at module scope (the `typeof window !== 'undefined'`
guard in `i18n.js:324` is there for exactly this reason and is load-bearing), and
`aiClient` takes its `fetch` by injection. That is what makes `tests/ai.test.mjs` possible
with zero dependencies, matching `tests/presets.test.mjs`.

**Wiring rule:** nothing changes in `index.html` for the JavaScript. `index.html:416` is the
only `<script>`, and a new module becomes part of the graph by being imported from
`js/main.js` — **with a relative specifier**, because the import-graph walker
(`tests/integration.html:1230`) only follows specifiers matching `['"](\.[^'"]+)['"]`. A bare
`'aiClient.js'` would silently escape the precache check and then 404 offline.

---

## 5. The compiler (`aiCompile.js`)

Defaults when no preset matched, chosen to sit inside `SPIN_LIMITS`:

| intent | speed | spin | type | height | drop | bpm |
| --- | --- | --- | --- | --- | --- | --- |
| `serve` (short) | 4.5 | 2.5 | back | 30 | per side | 60 |
| `serve` (long) | 5.5 | 3 | back | 55 | per side | 60 |
| `push` (rally) | 1.5 | 4 | back | 45 | −5 | 45 |
| `drive` | 5 | 3 | top | 55 | −5 | 72 |
| `loop` | 4 | 3.5 | back | 60 | −5 | 60 |
| `block` | 2 | 1 | top | 70 | 0 | 80 |

`intensity` scales `speed` ±0..2 within `LIMITS.speed`. Every value then goes through
`makeBall()`, which already enforces `normalizeSpin()` and `maxScatterFor()` — we never build
an array by hand. "fuerte" is a speed bump; it does **not** add scatter (that stays an
explicit "con dispersión" intent, so an AI drill can never surprise you mid-rally).

> ### The one vocabulary collision in this app, and how we resolve it
>
> **"Saque" and "push" are the same word in this app.** The factory key `push(b)` is
> labelled **"Saque(Rev.)"** in Spanish — but in table tennis a *serve* and a *push* are
> opposite ends of the table. One role cannot mean both, so `parseUtterance()` disambiguates
> from context, with a fixed rule rather than a guess:
>
> | you said | it is a **serve** | it is a **rally push** |
> | --- | --- | --- |
> | `"saque corto"`, `"push largo"`, `"serve to the backhand"` | ✅ depth word present | |
> | `"push b"`, `"push suave"`, `"push 3 veces"` | | ✅ no depth word, or an intensity word |
>
> Speed 4.5 vs 1.5, height 30 vs 45 — the difference between a serve and a rally push is the
> whole point of the distinction, so it gets a test in `ai.test.mjs` and the assistant says
> which reading it took when it is not obvious.


Output also carries a human readout per step, e.g.
*"Paso 2 — cortado largo al revés, del preset «Heavy backspin push», 3 repeticiones, 45 bpm"*
which is what gets spoken back.

---

## 6. Preset matching (`aiMatch.js`)

```
score = w_rot·d(rotation) + w_int·d(intensity) + w_depth·d(depth) + w_side·d(side)
```

- `d(rotation)` reads `preset.type` and `preset.spin`
- `d(intensity)` is `|preset.speed − target| / 10`
- `d(depth)` and `d(side)` prefer a **matching axis entry** in `preset.placements` /
  `preset.depths` by label (`BH`/`Center`/`FH`, `Short`/`Mid`/`Long`), falling back to
  `preset.drop` / `preset.height` — exactly the `standardPlacements(0)` anchoring trick the
  preset editor already uses
- below threshold → `null` → compile from defaults, and the step is flagged
  `usedFallback: true` so the assistant **says so out loud**

Your 8 shipped presets are all named in English, so matching on `"cortado"` → `back` +
`spin>2` is what actually carries it, not the name. This is why §9's glossary matters.

---

## 7. The agent loop (`aiClient.js` + `aiAgent.js`)

Standard OpenAI-compatible tool calling against `{baseUrl}/chat/completions`, with
`Authorization: Bearer`, plus `HTTP-Referer` / `X-Title` when the base is OpenRouter.
Hard caps: **8 tool rounds**, **45 s total**, abortable, one line of redacted usage shown
afterwards.

**Streaming is on by default.** A voice assistant that waits for the whole answer before it
says anything feels broken, and the user has to know it is *thinking* rather than *broken*.
`aiClient` parses SSE incrementally — no build step, no SDK, about 30 lines — and streams the
assistant's prose into the transcript and the speech queue as it arrives, while the tool
trace updates between rounds. A non-streaming fallback is one flag, for endpoints that do not
do SSE.

**The loop is only entered when Tier 0 did not finish the job** (§1.5). If the sentence parsed
cleanly, no request is made and no key is consulted.

### The tools

| Tool | Purpose |
| --- | --- |
| `list_drills()` / `get_drill(key)` | read the user's drills |
| `list_presets()` | read the library (id, name, describe) |
| `search_presets(intent)` | deterministic matcher, returns candidates + scores |
| `compose_drill({name, steps:[intent], use_presets:true})` | **the main one** — returns compiled steps, which preset was used per step, and a spoken readout |
| `update_draft({ops})` | add / remove / replace a step by index |
| `set_draft_name(name)` | |
| `create_preset({name, intent})` | compiles a step → a new preset (so the second time it's free) |
| `update_preset(id, patch)` / `delete_preset(id)` | **both require confirmation** |
| `open_draft_in_editor()` | materialise the draft into a real IA drill, then open the normal editor |
| `persist_draft()` / `discard_draft()` | the only two things that touch `localStorage` |
| `play_draft()` / `play_drill(key)` | |
| `ask_user(question, options[])` | renders as tappable buttons **and** speaks; the answer re-enters the loop |

Note what is **not** there: no tool writes a raw ball array, and no tool writes
`currentDrills` directly. `persist_draft` is the single funnel into storage.

---

## 8. Voice (`aiVoice.js`)

**Speech in — two paths, one interface:**

1. **Browser (default, no key).** `SpeechRecognition` / `webkitSpeechRecognition`, with
   `interimResults`, `lang` from the app language, and **`phrases` seeded with the app's own
   vocabulary** — every preset name, plus `saque, corto, largo, cruzado, al revés, top,
   back, drive, push, loop, fuerte, suave, repeticiones`. This is a large accuracy win for
   exactly the vocabulary that trips it up. Caveats, stated plainly: **Chrome + Safari only**,
   **not Baseline**, not in Firefox, and Chrome's engine is cloud-backed so it **does not
   work offline** — which is the opposite of everything else in this app. Newer Chrome also
   exposes `SpeechRecognition.available()` / `processLocally`; we feature-detect and say
   which path is live.
2. **API (the voice slot).** `MediaRecorder` → `POST {base}/audio/transcriptions` as
   multipart. For Firefox users, and for anyone who wants a better model.

**Speech out —** `speechSynthesis` by default: offline, free, no key, and it degrades
gracefully. An API TTS model is optional in the voice slot. Barge-in: starting to talk
cancels the reply mid-sentence.

**A testing fact you should know now:** neither the MCP browser nor headless Chrome has a
microphone. The panel therefore always has a text field, and the recognition object is
constructed through one seam (`aiVoice.setRecognitionFactory`) so the suite can drive a fake.
Live voice gets tested by you, on a phone, with real keys.

---

## 9. The system prompt

Short and blunt. The model is told:

- You are a table-tennis coach for the Nova S Pro robot.
- **You never produce numbers.** You produce intent objects from this fixed vocabulary.
- Reuse the user's presets when `search_presets` returns a good match; say so.
- If nothing matches, say "no encontré un preset, lo generé" — never invent a fake preset name.
- `persist_draft` is the user's decision, not yours. Propose, then stop.
- Reply in the app's language. Keep replies to one or two spoken sentences.

The **vocabulary table itself is data**, in `js/aiTerms.js`, bilingual (ES + EN), because it
is domain knowledge — not a UI string and not something that belongs in the locale files.

---

## 10. The panel (`aiUi.js`)

A full screen at **`z-index: 170`** — the free band between Statistics (160) and the modals
(200), so the preset sheet and the editor can still open over it. It goes in `index.html`
between `:202` (end of `#stats-view`) and `:204` (`#toast`), and it **reuses the existing
chrome** — `.settings-shell` / `.settings-header` / `.settings-back` / `.settings-body` —
exactly the way the statistics screen reuses it. Same `open/close/hidden` discipline as
`settingsUi.js` (remove `hidden` on open, put it back on close, and **declare no `display`
of its own**, or it keeps covering the drill list). **One** Escape handler: Settings owns
it, so the panel joins that chain rather than adding a listener — see the `statsUi.js` bug
in `AGENTS.md`.

Layout, top to bottom: **transcript** (interim in muted, final in normal) → **tool trace**
(`buscando presets…` / `usando «Safe push»` / `3 presets encontrados`) → **draft preview**
(one compact card per step: plain-language label, the tiny `Speed 4 · Spin 1.5 · TOP · 60 bpm`
line, a preset chip or a "generated" chip) → **action bar** (▶ Play · Open in editor · Save ·
Discard · Rename). A mic FAB sits bottom-right, ≥44 px, with a live level ring.

### The one security rule that matters most in this whole feature

**Model output is untrusted input. It is rendered with `textContent`, never `innerHTML`.**

This is the feature where the app's usual re-render pattern (`innerHTML` rebuilt from the
model) becomes dangerous: everything currently in the model came from the user, and now
something in it came from a remote server over the network. A model that echoes
`<img src=x onerror=…>` into a drill name, a step note, or a spoken-back error must not be
able to execute it.

Concretely: no `innerHTML`, no `insertAdjacentHTML`, no `data-i18n-html` (which assigns
`innerHTML` straight from the dictionary) on any node that can contain model text, and no
model string ever reaches a template literal in a `render()` function. `t()` does not escape
its parameters either. The transcript, the tool trace, the draft preview, the drill name and
every confirmation message are `textContent`.

The panel needs its **own** accessibility checks too — the suite's contrast / tap-target /
font-size loops are hard-coded per screen (preset UI `:536`, Settings `:612`, Statistics
`:700`), so a new root id is covered by none of them. Phase 4 copies the Statistics loop:
WCAG AA in all four themes, ≥44 px targets, ≥10 px text, no horizontal overflow.

Enter is the mic on desktop, text on mobile — or just a send button, which is less clever and
more predictable. Your call (§16 Q5).

---

## 11. i18n and the settings / BYOK surface

~45 new keys × 2 dictionaries. Four hard rules the suite will enforce, all learned the hard
way:

- **Key names used from a `t()` call site may not contain a hyphen.** The call-site scanner
  (`tests/integration.html:1450`) matches `t\(\s*['"]([\w.]+)['"]`. `data-i18n` in markup
  *does* allow hyphens (that is how `tab.custom-a` works), so: hyphens for markup keys,
  dots and word characters for code keys. I will use `ai.settings.textModel` style throughout.
- **A dictionary value is a string or `{one, other}`. Nothing else.** `i18n.js`'s `isPlural`
  is `typeof value === 'object'`, so an array would be silently read as a plural entry and
  `t()` would return the raw key. This is why the ES/EN vocabulary table in §9 is a **JS
  module**, not a dictionary.
- **Every `{placeholder}` must be filled at a real call site**, or the build fails.
- `t()` does not escape, and `data-i18n-html` assigns `innerHTML` — see §10.

Stored user data (drill names, preset names) is still **not** translated; an AI-generated
name is stored data, exactly as if you had typed it.

### The Settings section (`aiConfig.js`)

A new **"AI assistant"** section, above Presets, in `settingsUi.js`:

**Text model** — Provider (OpenRouter prefilled / Custom), Base URL, API key, Model,
"Fetch model list" button, **Test connection** with a real result line.

**Voice model** — same four fields, plus a **"Use the text model for voice too"** toggle that
copies the text slot across and greys the voice fields. This is the "same model for both" you
asked for, and it's a copy-on-toggle, not a shared pointer, so you can un-share it.

Also: **Speak replies** (on/off), **language** (inherit app / explicit), **"Remember this
conversation"** (off by default — history is per-session unless you turn it on), and
**Clear API key**.

**On key storage — the decision, and the caveat.** The key goes in `localStorage` under
`nova_ai_config`, the only place this app keeps user data, and it is sent **only** as an
`Authorization` header to the one base URL you typed, and never included in any log, toast,
export, error message or share code. I'll offer a **"session only (memory)"** option so it
dies with the tab. Honest caveat: `localStorage` is readable by any script on the origin, so
this is fine for a personal phone and is *not* fine on a shared machine — the settings copy
will say exactly that, in both languages.

---

## 12. Safety rails

- **Draft-first.** Nothing reaches `localStorage` without `persist_draft`. The assistant may
  *play* a draft; it may not *save* one unprompted.
- `update_preset` / `delete_preset` on anything you made → `ask_user` confirmation, spoken and
  tappable. Destructive labels use `--danger-ink`, never white on `--danger`.
- A drill is never auto-played without a Bluetooth connection — the button is disabled with a
  reason, exactly like the install row pattern already in `settingsUi.js:73`.
- No network call happens unless you pressed something. The service worker already leaves
  every cross-origin request alone (`sw.js:12-17`), so OpenRouter is never cached. Offline,
  the panel says AI needs a connection and everything else keeps working.
- Every `data-i18n` string and every `t()` call. No hardcoded colour in JS.

---

## 13. Prerequisite bugs found while planning

**Must be fixed before the assistant can play anything:**

1. **`runner.js:96` — `noteSessionDrill(drillName)` references an identifier that is not in
   scope.** `drillName` is a parameter of `startDrillSequence` (`:32`); `beginDrillExecution`
   cannot see it. In a module (strict mode) that is a `ReferenceError` on every single drill
   start, so the training history has not been recording since that line was added.
2. **`startDrillSequence()` has no in-memory entry point.** It reads `currentDrills[name]`
   only. Split it into `startSequence(steps, {label, random})` + a thin wrapper, and add a
   module-level `activeDrillName` that fix #1 then uses. The assistant calls `startSequence`.

**Must be fixed before the compiler can be written:**

3. **The `drop` sign is documented backwards in three places** — `ball.js:13`,
   `presets.js:13` and the `AGENTS.md` ball-array table all say `-10 (right) .. 10 (left)`,
   while the factory data and both user-facing hints say the opposite (§2). The compiler is
   going to hard-code this sign, so the wrong comment has to go first or it will be copied
   into new code and look authoritative.

**Not a bug, but a decision:** the shared drill CSV is byte-for-byte asserted by the suite.
Nothing in this feature may change `Set;Ball;Name;Speed;Spin;Type;Height;Drop;BPM;Reps`. AI
drills live in their own store and are simply not in that file until the user moves one to a
custom set.

---

## 14. Tests

The current gate is **`PASS(329)`** in the browser suite plus `node --test
tests/presets.test.mjs`. It is 329 now, not the 300 in the older `AGENTS.md` — nothing
here should hardcode a count, we just have to keep the title green.

**`tests/ai.test.mjs`** (node, zero deps, alongside the existing `presets.test.mjs`;
`localStorage` stub installed *before* any import, exactly as the existing file does):

- the compiler table, the `SPIN_LIMITS` clamp, `maxScatterFor`, no-hand-built arrays
- **Tier 0 `parseUtterance()`**, the important ones:
  - the example sentence → exactly 3 intents
- **the serve/push disambiguation** (§5): `"saque corto"` → serve/short (speed 4.5, height
  30), `"push b"` → rally push (speed 1.5, height 45)
  - `"push b, drive f"` → 2 steps, no model, no network
  - `"3Push b"` → one step, 3 reps
  - `"preset Safe push a la derecha"` → resolves by name against the library
  - a Spanish and an English spelling of the same command produce the *same* intents
  - `"empa/foo ??? ///"` → returns `null` and falls through to the model tier, never throws
- **the `drop` sign**: `"a la derecha"` → **positive**, `"al revés"` → **negative**,
  asserted against `constants.js`'s own `PUSH_B` / `PUSH_F` so the test fails if anyone
  re-flips the convention
- matching: hits `preset_short_under` for `{serve,short,fh}`, correctly returns `null` and
  flags fallback for `{serve, long, wide-fh}`
- `aiClient` against a **fake fetch**: a clean tool round, a 401, a malformed `tool_calls`,
  a model that never stops calling tools (the 8-round cap fires), an aborted request, a
  chunked SSE response that splits a tool call across two events
- config normalisation, and **key redaction in every error path**
- a hostile drill name from the "model" — quotes, brackets, angle brackets, 500 characters,
  an emoji — proving `drillKeyName()` holds and the rendered `data-key` attribute does not
- localStorage corruption → falls back, never throws

**`tests/integration.html`** (+~35 checks):

- every new module present in `PRECACHE` **and** in the walked import graph (`:1249`)
- i18n: `en.js`/`es.js` parity for all new keys, every new `data-i18n` resolving, the panel
  genuinely redrawing in Spanish
- Settings rows in all four states, key shown as `sk-…4f2a`, and **the key appears in no
  DOM dump of the panel, no log line, no toast and no error message**
- **XSS check**: a fake model returns `<img src=x onerror="window.__pwned=1">` as a drill
  name and a step note; assert `window.__pwned` is still undefined and the text is visible
  verbatim
- IA tab: draft → persist → row appears → move to Custom B → clear category
- **no network leak**: with `fetch` stubbed to reject, the panel still opens and the app
  still boots offline
- a new opt-in accessibility loop for `#ai-body`: contrast in all four themes, ≥44 px
  targets, ≥10 px text, no horizontal overflow

Note: **no existing check stubs `fetch`** — `js/cloud.js` is never imported by the suite and
the only interception is a parameter injected into the evaluated `sw.js`. Writing the first
network-test harness is part of Phase 3, not an extension of something that exists.

**MCP browser at `http://127.0.0.1:8123`** for the manual pass with real keys. ⚠️ Chrome is
**not running right now** — no `DevToolsActivePort`. Before that phase I'll need you to start
it with `--remote-debugging-port=9222`, or I'll start it as a managed background job.

---

## 15. Build order

| Phase | Delivers | Gate |
| --- | --- | --- |
| **0** | The three prerequisites in §13 (including the `drop` sign comments) | existing `PASS(329)` + node tests still green |
| **1** | `aiTerms` (vocabulary **+ `parseUtterance()`**, Tier 0) + `aiCompile` + `aiStore` + `ai.test.mjs` | node tests green, no UI, no key, no network |
| **2** | `aiUi` — panel, transcript, Tier 0 text entry, draft preview, play, persist | full pass; **a working assistant before any API key exists** |
| **3** | `aiConfig` + the Settings section (`own` / `follow-text`) | integration green; still no key ships |
| **4** | `aiClient` + the agent loop against a fake endpoint | first network-test harness in the repo |
| **5** | The model tier wired into the panel, tool trace, `ask_user` confirmations | full pass |
| **6** | The IA tab, category chip, move / clear | full pass |
| **7** | `aiVoice` — STT/TTS + the fake-recognition seam | full pass; live voice on a phone |
| **8** | `sw.js` `VERSION` v3→v4 + `PRECACHE`, README, `AGENTS.md` | deploy gates green |

The order is deliberate: **Phase 2 is the first user-visible value and it needs no key, no
network and no model.** Everything after it is an upgrade on top of something that already
works. Phases 3–5 are the BYOK work; 7 is voice and is last because it is the least portable
and the least testable part.

---

## 16. Decided vs. genuinely open

Most of what I originally flagged as a question is answerable from the app's own conventions.
Those are **decided** below and I will not ask you again. Three remain yours.

### Decided — Q1 "al revés"

Resolved in §2 from `constants.js` and both locale files. "Al revés" = `Rev.` = the
receiver's backhand side = **negative drop**. "A la derecha" = `Der.` = **positive drop**.
They are the two ends of one axis, not two different concepts. No new field needed.

### Decided — Q2 "corto" / "largo"

A height proxy, with the matched preset's own height winning. `es.js` already tells the user
exactly this. No new field, no new flag, nothing in the CSV changes.

### Decided — Q3 "same model for both"

Not copy-on-toggle, and not a live pointer — both have a failure mode. It is a **mode with
both behaviours and a visible state**:

```
voice.mode: 'own' | 'follow-text'
```

- `follow-text` resolves the voice model at call time from the text slot, and the settings
  row reads *"Using: `openai/gpt-4o-mini` — Detach"*, with a **Detach** button. Follow the text
  model, but you can always see what you are following and break the link in one tap.
- `own` shows the four voice fields and writes them to the voice slot.

This is what "use the same for both" actually means, and it never silently changes under you.

### Decided — Q4 confirmation policy

- **free:** play a draft, read anything, search presets, compose a draft, rename it
- **ask once, then remember for the turn:** persist a draft (`persist_draft`) — the assistant
  proposes, you tap or say yes
- **ask every time:** anything that deletes, or overwrites something you made
  (`delete_preset`, `update_preset` on a non-AI preset, clearing the IA category)

Playing a draft without asking is deliberate: nothing durable changes, and it is the whole
point of the feature.

### Decided — Q5 text entry

**Always-visible field.** Not a send button that expands, not "Enter is the mic on
desktop". A microphone button you can miss is a microphone button that gets abandoned, and
a send button that has to be discovered hides the fallback for exactly the people who need
it — no signal, no key, Firefox, or a noisy hall. The field is there, it is focused, and the
mic is the shortcut.

### Decided — Q6 which model

**We do not hardcode a model id.** They change, they are region- and account-dependent, and a
stale default is a confusing first run. The "Fetch model list" button calls `{base}/models`
and fills a picker; the field stays free-text so a self-hosted endpoint still works. I will
seed the picker with nothing and let the real list speak for itself.

### Decided — Q7 which language it speaks

**The app's language**, because that is already the app's one rule (`nova_lang` always wins,
`axisLabel()` follows it, the preset UI redraws on `locale-changed`). A Spanish UI with an
English coach would be the only part of the app that ignores the setting. The vocabulary
table is bilingual regardless, because the *inputs* are whatever the user says.

### Open — needs you

1. **Is the deterministic no-key tier in scope?** See §1.5. I think it should be, because
   this app's entire identity is "works at a table with no signal", and a feature that
   needs a network round-trip before it can answer `push b, drive f` is a step backwards.
2. **Which model for your first live test on OpenRouter?** Pick from the list once Settings
   can fetch it, or name one here.
3. **Should AI-generated drills count toward the statistics / training history?** Today a
   session is "one robot connection" and every drill folds into it. I would say **yes** — it
   is training, and excluding it would make the history a lie — but it is a change to what
   the numbers mean, so it is your call.

---

## 17. What I need from you to test

**Nothing yet.** Phases 0–2 are the whole of Tier 0 and need no key, no network and no
model — that is the point of §1.5. You can use, test and ship a working assistant before a
single API call is made.

When we reach **Phase 5** (the model tier, first live call), you'll need:

- an **OpenRouter API key**, typed by you into Settings → AI assistant → Text model. I'd
  rather you did not paste it into this conversation at all — it is then in a transcript
  neither of us controls. The app only ever sends it as an `Authorization` header to the one
  base URL you typed.
- optionally a **voice model id**, only if you want to exercise the API STT path rather
  than the browser's built-in recognition.

If you would rather I drive an end-to-end test myself, give me a key with a hard spend cap
and I will use it only against `openrouter.ai` — say so and I will ask before the first call.

### How the open questions were answered

All three of these were settled before Phase 0 and are now decided in the code:

1. **Tier 0 is in scope** — yes. It ships as the floor, and it is the reason the
   feature belongs in this app rather than being a step backwards from it.
2. **The uncommitted work in the tree** — theirs, and already committed as
   *"Let a drill be called whatever you want to call it"*. No collision.
3. **The §13 prerequisite fixes** — approved, including the `drop` sign comments
   in three files and `AGENTS.md`.

Open questions 2 and 3 in §16 were also answered: the first live model test ran
against `deepseek/deepseek-v4.1-flash` on OpenRouter, and **AI-generated drills
do count toward the training history** — a draft played from the panel goes
through the same `noteSessionDrill()` a saved drill does, because excluding it
would make the history a lie about what you actually did.
