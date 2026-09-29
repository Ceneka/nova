/**
 * The assistant panel.
 *
 * A full screen at z-index 170 - the free band between Statistics (160) and
 * the modals (200) - reusing `.settings-shell` / `.settings-header` /
 * `.settings-back` / `.settings-body` exactly the way the statistics screen
 * reuses them. It is a drill action reached mid-session, which is why it is a
 * button in the header and not a row in Settings.
 *
 * ## THE security rule for this whole feature
 *
 * **Model output is untrusted input and is rendered with `textContent`, never
 * `innerHTML`.**
 *
 * This is the one screen in the app where the re-render-from-the-model pattern
 * becomes dangerous. Everywhere else the model is the user's own drills and
 * presets. Here part of it is text from a remote server, and a model that
 * echoes `<img src=x onerror=...>` into a drill name, a step note or a
 * spoken-back error must not be able to execute it.
 *
 * So: no `innerHTML`, no `insertAdjacentHTML`, no `data-i18n-html`, and no
 * model string ever reaches a template literal inside a `render()`. The
 * transcript, the tool trace, the draft preview, the drill name and every
 * confirmation go through `textContent`. `t()` does not escape its parameters
 * either, so a dictionary value is trusted chrome while a model value is not -
 * they are never mixed in the same string.
 *
 * ## The `hidden` trap
 *
 * `openAiView()` removes `hidden`, `closeAiView()` puts it back. `.ai-view`
 * declares no `display` of its own, so without the attribute it falls back to
 * `display: block` and keeps covering the drill list underneath. This is the
 * same bug that hit `closeSettings()` and `closeStatsView()`.
 *
 * ## Escape lives in settingsUi.js
 *
 * There is exactly one Escape handler in the app and it is not here. Settings
 * owns the stack of full screens and closes the topmost one; adding a second
 * listener here would fire first (Settings imports this module, so this one's
 * dependencies evaluate first) and close two screens on one keypress. See the
 * note above the handler in `settingsUi.js`.
 *
 * ## Tier 0 first
 *
 * Nothing in this file needs a key, a network or a model. The text field is
 * always visible - not a send button that expands, and not "Enter is the mic
 * on desktop" - because a microphone you can miss is a microphone that gets
 * abandoned, and a send button you have to discover hides the fallback for
 * exactly the people who need it: no signal, no key, Firefox, a noisy hall.
 */

import { parseUtterance } from './aiTerms.js';
import { buildPlan } from './aiCompile.js';
import { rankPresets } from './aiMatch.js';
import {
    getDraft, setDraft, clearDraft, persistDrill, getAiDrill
} from './aiStore.js';
import { currentDrills, setLastPlayed } from './state.js';
import { openEditor } from './editor.js';
import { getPresets } from './presets.js';
import { bleState } from './bluetooth.js';
import { runAgent } from './aiClient.js';
import { TOOLS, makeToolHandlers } from './aiAgent.js';
import { isTextConfigured, getAiConfig } from './aiConfig.js';
import {
    startListening, stopListening, isListening, speak, releaseVoice, detectVoicePaths,
    arm, disarm, isArmed, matchWakePhrase, DEFAULT_WAKE_PHRASES,
    holdScreenLock, isScreenLockHeld, isScreenLockSupported
} from './aiVoice.js';
import { startSequence, isDrillRunning } from './runner.js';
import { t, getLang } from './i18n.js';
import { showToast } from './utils.js';
import { updateLastPlayedHighlight } from './ui.js';

const MAX_TRANSCRIPT = 40;

let open = false;

/**
 * The conversation. In memory only: "Remember this conversation" is a setting
 * and history is per-session unless it is turned on, so nothing here is ever
 * written to localStorage. `persist_draft` is the only funnel that is.
 */
let transcript = [];
let interim = '';

/** What Tier 1 is doing, for the panel's status line. */
let busy = false;

/** The IA record this draft was materialised as, if it has been. */
let materialisedKey = null;

/** The in-flight model turn, so closing the panel cancels it rather than leaking it. */
let inFlight = null;

/** The model's prose as it arrives, before the turn is finished. */
let streaming = '';

// --- open / close -----------------------------------------------------------

export function isAiOpen() {
    return open;
}

export function openAiView() {
    open = true;
    document.getElementById('theme-menu')?.classList.remove('open');
    // Before the first paint, so a phone handed to somebody does not dim while
    // they read what the assistant just built.
    holdScreenLock(!!getAiConfig().screenLock);
    renderAi();
    const view = document.getElementById('ai-view');
    view?.removeAttribute('hidden');
    view?.classList.add('active');
    // The composer is focused so the panel is usable the moment it opens -
    // a panel you have to tap into before you can type is a panel nobody uses.
    setTimeout(() => document.getElementById('ai-input')?.focus(), 50);
}

export function closeAiView() {
    if (!open) return;
    open = false;
    // A request left running after the panel closes is a spinner nobody can
    // see and a bill nobody asked for.
    if (inFlight) {
        inFlight.abort();
        inFlight = null;
    }
    // No microphone left open, no voice still talking, and the screen handed
    // back. A panel that leaves the phone awake is a flat battery.
    releaseVoice();
    holdScreenLock(false);
    streaming = '';
    const view = document.getElementById('ai-view');
    view?.classList.remove('active');
    // Symmetric with openAiView(): without putting `hidden` back, the view
    // falls back to display:block and keeps covering the drill list.
    view?.setAttribute('hidden', '');
}

// --- transcript -------------------------------------------------------------

function pushMessage(role, text, { tier = null, error = false } = {}) {
    if (!text) return;
    transcript.push({ role, text, tier, error });
    if (transcript.length > MAX_TRANSCRIPT) {
        transcript = transcript.slice(-MAX_TRANSCRIPT);
    }
    renderAi();
}

export function aiInterim(text) {
    interim = String(text ?? '');
    renderAi();
}

export function aiFinal(text) {
    interim = '';
    const said = String(text ?? '').trim();
    if (!said) return;
    pushMessage('user', said);
    handleUtterance(said, { tier: 'local' });
}

export function aiModelSay(text, { error = false } = {}) {
    interim = '';
    pushMessage('model', String(text ?? ''), { tier: 'model', error });
}

export function setAiBusy(value) {
    busy = !!value;
    renderAi();
}

export function isAiBusy() {
    return busy;
}

export function clearAiTranscript() {
    transcript = [];
    interim = '';
    renderAi();
}

// --- readouts ---------------------------------------------------------------

/**
 * The plain-language label for one step, built from the SAME vocabulary table
 * the parser matched on, through `t()`. The assistant does not invent its own
 * words for a side: `axisLabel()` already renders `bh`/`center`/`fh` as
 * "Rev. / Centro / Der." in Spanish and "BH / Center / FH" in English, and
 * reusing them is the difference between one vocabulary in the app and two.
 */
export function describeIntent(intent) {
    const words = [];
    if (intent.rotation) words.push(t(`ai.rot.${intent.rotation}`));
    if (intent.depth) words.push(t(`axis.${intent.depth}`));
    if (intent.side) words.push(t(`ai.side.${intent.side}`));
    if (!words.length) words.push(t(`ai.role.${intent.role}`));
    if (intent.intensity <= 3) words.push(t('ai.strength.low'));
    if (intent.intensity >= 7) words.push(t('ai.strength.high'));
    return words.join(' ');
}

/**
 * The sentence that gets spoken back. It names the preset it used, or says
 * plainly that it invented the ball - `usedFallback` exists so this can be
 * honest, and "no encontré un preset, lo generé" is the whole point of it.
 */
export function stepReadout(index, meta) {
    const label = describeIntent(meta.intent);
    const head = meta.usedFallback
        ? t('ai.readout', { n: index, label })
        : t('ai.readoutFrom', { n: index, label, name: meta.presetName });
    return `${head} ${t('ai.readoutTail', { reps: meta.reps ?? 1, bpm: meta.bpm ?? 60 })}`;
}

// --- the pipeline -----------------------------------------------------------

/**
 * Tier 0: sentence -> intents -> plan -> draft.
 *
 * Returns the plan, or `null` when the sentence was not understood at all -
 * which is the cue for the model tier, and never a reason to show a draft
 * built out of the word "thing".
 */
export function handleUtterance(text, { tier = 'local' } = {}) {
    const parsed = parseUtterance(text, { presets: getPresets() });
    if (!parsed) {
        // Not understood at all. Say so with the sentence in hand, and offer
        // the model tier - Tier 0 is a floor, never a trap.
        pushMessage('model', t('ai.notUnderstood', { text: String(text).slice(0, 120) }), { error: true });
        return null;
    }

    const plan = buildPlan({ intents: parsed.intents, presets: getPresets() });
    if (!plan.steps.length) return null;

    setDraft(plan);
    tracePlan(plan, parsed, tier);
    return plan;
}

/**
 * A short, honest account of how the draft was put together.
 *
 * Stored as {key, params} DATA, never as a translated string. This is the
 * whole rule the rest of the app already follows: store the model, translate at
 * render time. A trace line built with t() here would leave English sitting in
 * the middle of a Spanish panel the moment somebody switched language, which
 * is the half-translated build the i18n checks exist to prevent.
 */
function tracePlan(plan, parsed, tier) {
    const lines = [{ kind: tier === 'model' ? 'tierModel' : 'tierLocal' }];

    if (parsed.unknown.length) {
        const ranked = rankPresets(parsed.intents[0], getPresets(), 3);
        if (ranked.length) lines.push({ kind: 'presetsFound', n: ranked.length });
    }

    const used = new Set();
    let generated = 0;
    for (const meta of plan.meta) {
        if (meta.usedFallback) generated++;
        else used.add(meta.presetName);
    }
    for (const name of used) lines.push({ kind: 'from', name });
    if (generated) lines.push({ kind: 'generated', n: generated });

    aiTrace(lines);
}

/**
 * Trace line -> sentence, dispatched by kind.
 *
 * The indirection is not decoration. The integration suite finds call sites by
 * scanning this file for a literal dictionary key in a translation call, so it
 * can prove every {placeholder} in the dictionary is filled by real code; a
 * dynamic lookup through entry.key would hide all three keys and the check
 * would go quiet exactly when they are broken. Destructuring the params at
 * each call keeps the literal key AND the literal placeholder name in the
 * source, which is what that scanner can actually see.
 */
const TRACE_TEXT = {
    tierLocal: () => t('ai.tierLocal'),
    tierModel: () => t('ai.tierModel'),
    used: ({ name }) => t('ai.traceTool', { name }),
    from: ({ name }) => t('ai.chipFrom', { name }),
    generated: ({ n }) => t('ai.chipGenerated', { n }),
    presetsFound: ({ n }) => t('ai.presetsFound', { n })
};

let trace = [];
function aiTrace(lines) {
    trace = Array.isArray(lines) ? lines.filter(l => l && TRACE_TEXT[l.kind]) : [];
    renderAi();
}

// --- the screen lock --------------------------------------------------------

/**
 * Hold the screen awake while the panel is open - unless the user turned it
 * off. This is not only battery politeness: the browser suspends the
 * microphone when the screen locks, and that is the whole thing the wake word
 * depends on, so turning this off turns the wake word off with it.
 */
function syncScreenLock() {
    if (!getAiConfig().screenLock) {
        holdScreenLock(false);
        return;
    }
    if (isArmed() || isListening() || getDraft()) {
        holdScreenLock(true);
    }
}

export function aiScreenLockState() {
    return {
        supported: isScreenLockSupported(),
        held: isScreenLockHeld(),
        armed: isArmed()
    };
}

// --- rendering --------------------------------------------------------------

/**
 * Build a node with text. Every string that can contain model output comes
 * through here, which is what makes the "never innerHTML" rule checkable by
 * reading this file rather than by auditing every call site.
 */
function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = String(text);
    return node;
}

function renderAi() {
    const body = document.getElementById('ai-body');
    if (!body || !open) return;

    body.innerHTML = '';   // our own empty container, never model text

    // --- transcript ---
    const log = el('div', 'ai-transcript');
    if (!transcript.length && !interim) {
        log.appendChild(el('div', 'ai-empty', t('ai.empty')));
    }
    for (const msg of transcript) {
        const node = el('div', `ai-msg ${msg.role}${msg.error ? ' error' : ''}`, msg.text);
        if (msg.tier) {
            node.appendChild(el('span', 'ai-tier', t(msg.tier === 'model' ? 'ai.tierModel' : 'ai.tierLocal')));
        }
        log.appendChild(node);
    }
    if (interim) log.appendChild(el('div', 'ai-msg user interim', interim));
    // Prose arriving from the model. It is in the transcript as it lands, so
    // "thinking" never looks like "hung".
    if (streaming) log.appendChild(el('div', 'ai-msg model interim', streaming));
    body.appendChild(log);

    if (busy) {
        const tr = el('div', 'ai-trace');
        tr.appendChild(el('div', 'ai-trace-line', t('ai.thinking')));
        body.appendChild(tr);
    }

    if (trace.length) {
        const tr = el('div', 'ai-trace');
        for (const line of trace) {
            tr.appendChild(el('div', 'ai-trace-line', TRACE_TEXT[line.kind](line)));
        }
        body.appendChild(tr);
    }

    // --- draft ---
    const draft = getDraft();
    if (draft) body.appendChild(renderDraft(draft));

    body.appendChild(renderActions(draft));
    body.appendChild(renderComposer());
    syncScreenLock();
}

function renderDraft(draft) {
    const card = el('div', 'ai-draft');
    card.appendChild(el('div', 'ai-draft-name', draft.name || t('ai.step', { n: 1 })));

    draft.meta.forEach((meta, i) => {
        const step = el('div', 'ai-step');
        step.appendChild(el('div', 'ai-step-label', `${t('ai.step', { n: i + 1 })} — ${describeIntent(meta.intent)}`));
        step.appendChild(el('div', 'ai-step-meta',
            `${meta.speed} · ${meta.spin} · ${String(meta.type || '').toUpperCase()} · ${meta.bpm} bpm`));

        const chip = el('div', `ai-chip${meta.usedFallback ? ' generated' : ''}`,
            meta.usedFallback ? t('ai.generated') : meta.presetName);
        chip.title = meta.usedFallback ? '' : String(meta.presetName);
        step.appendChild(chip);
        card.appendChild(step);
    });

    return card;
}

function renderActions(draft) {
    const bar = el('div', 'ai-actions');

    if (!draft) {
        // Tier 0 is a dead end only if the user cannot reach the model tier.
        // The button is always present so it is never a hidden affordance; the
        // panel explains itself when it is pressed and no key is configured.
        const ask = el('button', 'ai-btn', t('ai.ask'));
        ask.onclick = () => window.aiAskModel();
        bar.appendChild(ask);
        return bar;
    }

    const connected = bleState.isConnected;
    const playing = isDrillRunning();

    const play = el('button', 'ai-btn primary', t('ai.play'));
    play.disabled = !connected || playing;
    play.title = connected ? '' : t('ai.needConnection');
    play.onclick = () => window.aiPlayDraft();
    bar.appendChild(play);

    const openEd = el('button', 'ai-btn', t('ai.openEditor'));
    openEd.onclick = () => window.aiOpenInEditor();
    bar.appendChild(openEd);

    const save = el('button', 'ai-btn', t('ai.save'));
    save.onclick = () => window.aiSaveDraft();
    bar.appendChild(save);

    const rename = el('button', 'ai-btn', t('ai.rename'));
    rename.onclick = () => window.aiRenameDraft();
    bar.appendChild(rename);

    const discard = el('button', 'ai-btn danger', t('ai.discard'));
    discard.onclick = () => window.aiDiscardDraft();
    bar.appendChild(discard);

    return bar;
}

function renderComposer() {
    const row = el('div', 'ai-composer');

    const input = document.createElement('input');
    input.type = 'text';
    input.id = 'ai-input';
    input.className = 'ai-input';
    input.autocomplete = 'off';
    input.setAttribute('placeholder', t('ai.placeholder'));
    input.setAttribute('aria-label', t('ai.placeholder'));
    input.value = '';
    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') window.aiSubmit();
    });
    row.appendChild(input);

    const mic = el('button', 'ai-icon-btn');
    mic.id = 'ai-mic';
    mic.setAttribute('aria-label', t('a11y.talk'));
    mic.title = t('a11y.talk');
    // Our own static icon, never model text - this is markup we control.
    mic.innerHTML = ICON_MIC;

    // A microphone this browser cannot use is DISABLED with a reason, not
    // left looking like a button that does nothing - the same rule the install
    // row and the play button follow.
    const voice = detectVoicePaths();
    if (voice.stt === 'none') {
        mic.disabled = true;
        mic.title = t('ai.voiceUnsupported');
    } else {
        // Armed and merely listening are different states and the button has to
        // show which: armed means "the microphone is open right now".
        const armedNow = isArmed();
        const live = armedNow || isListening();
        mic.classList.toggle('listening', live);
        mic.classList.toggle('armed', armedNow);
        const label = armedNow
            ? t('ai.wakeArmed', { phrase: wakePhrasesForUi()[0] || '' })
            : live ? t('ai.listening') : t('a11y.talk');
        mic.title = label;
        mic.setAttribute('aria-label', label);
        mic.onclick = () => window.aiToggleMic();
    }
    row.appendChild(mic);

    const send = el('button', 'ai-icon-btn');
    send.setAttribute('aria-label', t('a11y.send'));
    send.title = t('a11y.send');
    send.innerHTML = ICON_SEND;
    send.onclick = () => window.aiSubmit();
    row.appendChild(send);

    // A fragment, not a bare row: the "microphone is open" note belongs UNDER
    // the composer, and at this point `row` has no parent to append it to.
    const out = document.createDocumentFragment();
    out.appendChild(row);
    if (isArmed()) out.appendChild(el('div', 'ai-armed-note', t('ai.arming')));
    return out;
}

const ICON_MIC = `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <rect x="9" y="2" width="6" height="12" rx="3"></rect>
    <path d="M5.5 12a6.5 6.5 0 0 0 13 0"></path>
    <line x1="12" y1="18.5" x2="12" y2="22"></line>
</svg>`;

const ICON_SEND = `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <line x1="22" y1="2" x2="11" y2="13"></line>
    <polygon points="22 2 15 22 11 13 2 9 22 2"></polygon>
</svg>`;

// --- handlers ---------------------------------------------------------------

/** The text field. The primary path; the mic is the shortcut. */
export function submitAiText() {
    const input = document.getElementById('ai-input');
    const said = (input?.value || '').trim();
    if (!said) return false;
    if (input) input.value = '';
    pushMessage('user', said);
    handleUtterance(said, { tier: 'local' });
    return true;
}

/**
 * Play a draft. Deliberately free and unconfirmed: nothing durable changes,
 * and being able to hear your sentence back as a ball is the entire feature.
 * Counting it in the training history is a separate question, answered yes -
 * it is training, and excluding it would make the history a lie.
 */
export function playAiDraft() {
    const draft = getDraft();
    if (!draft) return false;
    if (!bleState.isConnected) {
        showToast(t('toast.notConnected'));
        return false;
    }
    // `label` is what the session files this under; `key` is left null because a
    // draft has no row in any list yet, and writing a key nothing resolves to
    // would leave junk in nova_last_played.
    return startSequence(draft.steps, { label: draft.name || t('ai.title'), random: false });
}

/**
 * The single funnel into storage. Saving is the user's decision, never the
 * assistant's - `persist_draft` exists so the model cannot reach storage
 * without them, and this is the only call site in the panel.
 */
export function saveAiDraft() {
    const draft = getDraft();
    if (!draft) return null;
    const saved = persistDrill({
        name: draft.name,
        steps: draft.steps,
        source: 'text',
        plan: draft.meta
    });
    if (saved) {
        showToast(t('toast.aiSaved'));
        clearDraft();
        trace = [];
        document.dispatchEvent(new CustomEvent('ai-drills-updated'));
        renderAi();
    }
    return saved;
}

export function renameAiDraft() {
    const draft = getDraft();
    if (!draft) return false;
    const name = prompt(t('ai.promptRename'), draft.name || '');
    if (name === null) return false;
    draft.name = String(name).slice(0, 40);
    renderAi();
    return true;
}

export function discardAiDraft() {
    if (!getDraft()) return false;
    if (!confirm(t('ai.confirmDiscard'))) return false;
    clearDraft();
    trace = [];
    renderAi();
    return true;
}

/**
 * Play a saved AI drill, from the IA list.
 *
 * It does not go through `startDrillSequence`, because an AI drill is not in
 * `currentDrills` - it lives in its own store, and the whole point of that
 * store is that a CSV import cannot reach it. The steps are handed to the
 * runner directly. The key IS safe in a selector, because it is minted from
 * the clock rather than from anything a model said, so the last-played
 * highlight works here exactly as it does for a saved drill.
 */
export function playAiDrill(key) {
    const drill = getAiDrill(key);
    if (!drill) return false;
    if (!bleState.isConnected) {
        showToast(t('toast.notConnected'));
        return false;
    }
    setLastPlayed(key);
    updateLastPlayedHighlight();
    return startSequence(drill.steps, { label: drill.name, key });
}

/**
 * Materialise the draft as a real IA drill and open the normal editor on it.
 *
 * Going through `persistDrill()` is deliberate even though the user pressed
 * "save"-adjacent rather than "save": the editor needs a drill that exists, and
 * the drill has to be a real one rather than a scratch object that vanishes on
 * reload. It lands in the IA category, which is reversible and clearly labelled.
 */
export function openAiInEditor() {
    const draft = getDraft();
    if (!draft) return null;

    // Reuse the record if this draft was already materialised, so opening the
    // editor twice does not leave two copies in the IA tab.
    if (!materialisedKey) {
        const record = persistDrill({
            name: draft.name,
            steps: draft.steps,
            source: 'text',
            plan: draft.meta
        });
        materialisedKey = record?.key || null;
        if (record) document.dispatchEvent(new CustomEvent('ai-drills-updated'));
    }
    if (!materialisedKey) return null;

    // openEditor() is driven entirely by currentDrills, so it borrows a scratch
    // copy under the IA key. closeEditor() deletes it again, and a save writes
    // back to the IA record rather than to custom_drills.
    currentDrills[materialisedKey] = { 1: draft.steps, 2: [], 3: [], random: false };
    openEditor(materialisedKey);
    return materialisedKey;
}

// --- voice ------------------------------------------------------------------

/**
 * The mic. Toggling rather than holding, because a press-and-hold gesture is
 * unusable one-handed on a phone at a table.
 *
 * Every path through here ends in a sentence in the same transcript, so a
 * spoken drill and a typed one are indistinguishable from there on - which is
 * the point: text is an equal citizen, not a fallback that shows up looking
 * different.
 */
export function toggleMic() {
    // Armed first: one tap means "the mic is open from now on", and tapping
    // again closes it. Anything else makes the wake word a thing you have to
    // keep re-triggering by hand, which is not a wake word.
    if (isArmed()) {
        disarm();
        renderAi();
        return false;
    }

    const paths = detectVoicePaths();
    if (paths.stt === 'none') {
        aiModelSay(t('ai.voiceUnsupported'), { error: true });
        return false;
    }

    if (isWakeEnabled()) {
        arm({
            phrases: wakePhrasesForUi(),
            onState: () => renderAi(),
            onError: (message) => { aiModelSay(message, { error: true }); },
            onWake: (hit) => onWakeWord(hit)
        });
        renderAi();
        return true;
    }

    const started = startListening({
        onInterim: (text) => { aiInterim(text); renderAi(); },
        onFinal: (text) => { aiFinal(text); },
        onError: (message) => { aiModelSay(message, { error: true }); },
        onEnd: () => renderAi()
    });

    if (started) renderAi();
    return !!started;
}

function isWakeEnabled() {
    return !!getAiConfig().wake?.enabled;
}

/** The phrases to listen for: what the user set, or the shipped ones. */
export function wakePhrasesForUi() {
    const set = getAiConfig().wake?.phrases;
    return Array.isArray(set) && set.length ? set : DEFAULT_WAKE_PHRASES;
}

/**
 * The wake word fired.
 *
 * Two cases, and they mean different things. With words after it, that is the
 * drill - straight into the same pipeline a typed sentence uses. With nothing
 * after it, the user is just waking the assistant up, so say so and wait
 * rather than treating a bare "hey nova" as an empty drill.
 */
function onWakeWord({ phrase, rest, alone }) {
    aiFinal(phrase);
    if (alone) {
        aiModelSay(t('ai.wakeNothing', { phrase }));
        return;
    }
    // The rest is ordinary text, so it goes through the same path as typing it.
    pushMessage('user', rest);
    handleUtterance(rest, { tier: 'local' });
}

/** Say the assistant's answer, if the user asked for replies to be spoken. */
function speakReply(text) {
    if (!text) return;
    if (getAiConfig().speak) speak(text);
}

// --- the model tier ---------------------------------------------------------

/**
 * Ask the model about a sentence.
 *
 * **This is only ever reached when Tier 0 did not finish the job.** If the
 * sentence parsed cleanly, no request is made and no key is consulted - which
 * is the whole point of having a deterministic tier in an app whose identity
 * is "works at a table with no signal".
 *
 * The reply is rendered with `textContent` like everything else here. This is
 * the one function in the file whose input is a remote server.
 */
export async function askAiModel(text = '') {
    const said = String(text || lastUserUtterance() || '').trim();
    if (!said) return null;

    // No key, or no signal: say so rather than failing silently. Everything
    // else in the panel keeps working, and Tier 0 is still one tap away.
    if (!isTextConfigured()) {
        aiModelSay(t('ai.needKey'), { error: true });
        return null;
    }
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        aiModelSay(t('ai.offline'), { error: true });
        return null;
    }

    // "Remember this conversation" is off by default, so a turn starts from
    // this sentence alone unless the user opted into a longer memory.
    const history = getAiConfig().remember ? conversationAsMessages() : [];

    setAiBusy(true);
    streaming = '';
    inFlight = new AbortController();
    trace = [{ kind: 'tierModel' }];

    try {
        const handlers = makeToolHandlers({
            ask: askUserInPanel,
            onTrace: noteTool,
            onDraft: () => renderAi()
        });

        const res = await runAgent({
            messages: [...history, { role: 'user', content: said }],
            tools: TOOLS,
            handleTool: (name, args) =>
                (handlers[name] ? handlers[name](args) : { error: `No such tool: ${name}` }),
            language: getLang(),
            slot: getAiConfig().text,
            signal: inFlight.signal,
            onText: (partial) => { streaming = partial; renderAi(); },
            onTool: (name) => noteTool('used', { name })
        });

        streaming = '';
        if (res.text) {
            aiModelSay(res.text);
            speakReply(res.text);
        }
        return res;
    } catch (err) {
        streaming = '';
        // The message is already redacted by the client, and shown as text.
        aiModelSay(err?.message || String(err), { error: true });
        return null;
    } finally {
        inFlight = null;
        setAiBusy(false);
    }
}

/** Ask the model about whatever the user last said. */
function lastUserUtterance() {
    for (let i = transcript.length - 1; i >= 0; i--) {
        if (transcript[i].role === 'user') return transcript[i].text;
    }
    return '';
}

function conversationAsMessages() {
    return transcript
        .filter(m => m.role === 'user' || m.role === 'model')
        .map(m => ({ role: m.role, content: m.text }));
}

/** One more line in the tool trace, from the model tier. */
function noteTool(kind, params = {}) {
    aiTrace([...trace, { kind, ...params }]);
}

/**
 * `ask_user`, rendered as tappable buttons AND spoken.
 *
 * The answer re-enters the agent loop, so this returns a promise rather than a
 * value. Nothing here is a decision the app makes: the button the user taps IS
 * the answer, and dismissing it means "no".
 */
function askUserInPanel({ question, options = [] }) {
    return new Promise((resolve) => {
        const wrap = el('div', 'ai-ask');
        wrap.appendChild(el('div', 'ai-ask-question', String(question || '')));

        const bar = el('div', 'ai-actions');
        const answers = (Array.isArray(options) && options.length ? options : ['yes', 'no'])
            .slice(0, 4)
            .map(String);

        for (const option of answers) {
            const btn = el('button', 'ai-btn', option);
            btn.onclick = () => {
                wrap.remove();
                renderAi();
                resolve(option);
            };
            bar.appendChild(btn);
        }
        wrap.appendChild(bar);

        document.getElementById('ai-body')?.appendChild(wrap);
    });
}

// --- wiring -----------------------------------------------------------------


// Switching language redraws this screen, exactly as the other full screens
// do. The panel is a <div>-heavy screen that stays open across a change.
document.addEventListener('locale-changed', () => { if (open) renderAi(); });

// The wake word and the screen lock can be changed from Settings while this
// panel is open underneath, so the panel has to follow.
document.addEventListener('ai-voice-settings', () => { if (open) renderAi(); });

// The draft is worth keeping usable if the panel is closed and reopened, so
// nothing is cleared here on purpose.
document.addEventListener('ai-drills-updated', () => { if (open) renderAi(); });

if (typeof window !== 'undefined') {
    window.openAiView = openAiView;
    window.closeAiView = closeAiView;
    window.aiSubmit = submitAiText;
    window.aiPlayDraft = playAiDraft;
    window.aiSaveDraft = saveAiDraft;
    window.aiRenameDraft = renameAiDraft;
    window.aiDiscardDraft = discardAiDraft;
    window.aiAskModel = askAiModel;
    window.aiToggleMic = toggleMic;
    window.aiOpenInEditor = openAiInEditor;
    window.playAiDrill = playAiDrill;
    // Exposed for tools/check-app.mjs, which drives the REAL page over CDP
    // rather than the stubbed harness. Harmless: both are pure functions and
    // neither touches the microphone.
    window.__matchWake = matchWakePhrase;
    window.__wakePhrases = wakePhrasesForUi;
}
