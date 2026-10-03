/**
 * Speech in and speech out.
 *
 * ## Two paths for each, one interface
 *
 * **Speech in.**
 *  1. **Browser (default, no key).** `SpeechRecognition` /
 *     `webkitSpeechRecognition`, with `interimResults` so the user can see it is
 *     hearing them, `lang` taken from the app's language, and - the part that
 *     actually matters for accuracy - `phrases` seeded with the app's own
 *     vocabulary: every preset name plus the stroke words. Recognition engines
 *     are wildly better at words they have been told to expect, and this is
 *     exactly the vocabulary that trips them up.
 *  2. **API (the voice slot).** `MediaRecorder` -> multipart POST to
 *     `{base}/audio/transcriptions`. For Firefox, and for anyone who wants a
 *     better model.
 *
 * Stated plainly, because it cuts against everything else in this app:
 * **Chrome and Safari only, not Baseline, not Firefox** - and Chrome's engine
 * is cloud-backed, so it **does not work offline**. That is the opposite of
 * every other feature here, which is precisely why Tier 0 is the floor and
 * this is not.
 *
 * Newer Chrome exposes `SpeechRecognition.available()` and `processLocally`;
 * both are feature-detected and reported, never assumed.
 *
 * **Speech out.** `speechSynthesis` by default: offline, free, no key, and it
 * degrades gracefully when there are no voices installed. An API TTS model is
 * optional in the voice slot. Starting to talk cancels the reply mid-sentence -
 * barge-in - because a user who interrupted you does not want to keep listening.
 *
 * ## The testing fact you should know now
 *
 * Neither the MCP browser nor headless Chrome has a microphone. So the panel
 * always has a text field, and the recognition object is built through ONE
 * seam, `setRecognitionFactory()`, which the suite uses to install a fake. Live
 * voice gets tested by a person, on a phone, with real keys.
 *
 * Node-safe: every browser API is reached through a guard, so this imports
 * cleanly under bare Node.
 */

import {
    getAiConfig, resolveVoiceSlot, isVoiceConfigured, transcriptionsUrl, buildHeaders, redact
} from './aiConfig.js';
import { t } from './i18n.js';
import { getPresets } from './presets.js';

/** Which paths this browser can actually offer, for the panel to say out loud. */
export const VOICE_PATHS = {
    stt: 'none',        // 'browser' | 'api' | 'none'
    tts: 'none',        // 'browser' | 'api' | 'none'
    detail: ''          // a human sentence, already translated
};

// --- the recognition seam ---------------------------------------------------

/**
 * The ONE place a SpeechRecognition object is constructed.
 *
 * Everything else in this file goes through it, which is what lets the suite
 * drive a fake: there is no microphone and no engine in headless Chrome, so
 * without a seam this whole module would be untestable and the mic button
 * would be a thing nobody ever presses before it ships.
 */
let recognitionFactory = null;

function defaultRecognitionFactory() {
    if (typeof window === 'undefined') return null;
    const Ctor = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!Ctor) return null;
    return new Ctor();
}

export function setRecognitionFactory(fn) {
    recognitionFactory = fn;
}

export function resetRecognitionFactory() {
    recognitionFactory = null;
}

/** The vocabulary handed to the recogniser as `phrases`. */
export function voicePhrases() {
    const base = [
        'saque', 'sacar', 'corto', 'corta', 'largo', 'larga', 'cruzado', 'lateral',
        'al revés', 'reves', 'a la derecha', 'al medio', 'centro',
        'top', 'topspin', 'back', 'backspin', 'drive', 'push', 'loop', 'bloqueo',
        'fuerte', 'suave', 'preset', 'variantes', 'secuencia',
        'serve', 'short', 'long', 'backhand', 'forehand', 'middle', 'strong', 'soft',
        'repetitions', 'reps', 'bpm'
    ];
    // The user's own preset names are the hardest words for the engine and the
    // most obvious ones to teach it.
    for (const p of getPresets()) if (p?.name) base.push(p.name);
    return [...new Set(base)];
}

/** What this browser can do, recomputed rather than cached - it can change. */
/**
 * Whether the microphone should record and send rather than listen locally.
 *
 * **The voice slot has to be pointed at a model on purpose.** `voice.mode`
 * defaults to `'follow-text'`, and `resolveVoiceSlot()` then hands back the
 * TEXT slot - so "is a voice model configured" is true for anybody who has ever
 * configured a chat model, and routing on that posts recordings to a model that
 * answers in text. That is a baffling failure for somebody who only ever set up
 * a key for talking to the assistant, and it is worse than useless: it silently
 * replaces a working free microphone with a bill.
 *
 * So the API microphone needs a DETACHED voice slot with its own model. That is
 * also the only configuration where the user can have chosen a transcription
 * model, which is a different thing from a chat model and not something this
 * app should guess at.
 */
export function apiSttReady() {
    const c = getAiConfig();
    if (c?.voice?.mode !== 'own') return false;
    return isVoiceConfigured() && canRecordAudio();
}

export function detectVoicePaths() {
    const hasRecognition = typeof window !== 'undefined'
        && !!(window.SpeechRecognition || window.webkitSpeechRecognition);
    const hasSynthesis = typeof window !== 'undefined' && 'speechSynthesis' in window;
    const api = isVoiceConfigured();

    // Speech IN prefers the configured voice model, and this order is the
    // opposite of what it was. It used to prefer the browser whenever the
    // browser had recognition, which made the voice slot a setting that stored
    // a key and then never called anything - the 'api' branch was computed,
    // displayed, and had no implementation behind it.
    //
    // The fallback is still the browser, and it is reached when there is no
    // voice model OR when this browser cannot record: a model configured on a
    // browser with no microphone must not leave the user with a dead button.
    VOICE_PATHS.stt = apiSttReady() ? 'api' : (hasRecognition ? 'browser' : 'none');

    // Speech OUT is the reverse, deliberately and for good reason: there is no
    // API TTS in this app, `speechSynthesis` is free, offline, and needs no key,
    // and OpenRouter is not a speech service. The 'api' value here is a promise
    // with nothing behind it, so it is reported as none rather than as a path
    // that does not exist.
    VOICE_PATHS.tts = hasSynthesis ? 'browser' : 'none';

    // Report honestly about recognition being on-device or not. Chrome's
    // engine is cloud-backed today and the local variant is opt-in per
    // language, so "needs a connection" is the true default; `available()` is
    // asynchronous and is not awaited on a synchronous path check.
    if (hasRecognition) {
        VOICE_PATHS.detail = t('ai.voiceCloud');
    } else {
        VOICE_PATHS.detail = t('ai.voiceUnsupported');
    }
    return VOICE_PATHS;
}

function getSpeechLang() {
    return getAiConfig().voice.language || 'en';
}

/**
 * An engine error code -> a sentence.
 *
 * Dispatched by literal key rather than built from the code, for the same
 * reason the panel's tool trace is: the integration suite proves every
 * {placeholder} in the dictionary is filled by scanning for literal keys in a
 * translation call, and a dynamically built key hides all of these at once.
 */
const VOICE_ERRORS = {
    'not-allowed': () => t('ai.voiceErrorNotAllowed'),
    'service-not-allowed': () => t('ai.voiceErrorNotAllowed'),
    'audio-capture': () => t('ai.voiceErrorNoMic'),
    network: () => t('ai.voiceErrorNetwork'),
    'language-not-supported': () => t('ai.voiceErrorLanguage')
};

/** Unknown codes get one honest sentence rather than a key on screen. */
export function voiceErrorText(code) {
    const known = VOICE_ERRORS[code];
    return known ? known() : t('ai.voiceErrorGeneric');
}

// --- speech in --------------------------------------------------------------

// --- the screen lock -------------------------------------------------------
//
// Two features depend on this and it is worth being blunt about why.
//
// **A web page cannot hold a microphone once the browser suspends it**, and
// Chrome suspends `SpeechRecognition` when the page is hidden OR when the
// screen locks. That is what makes a wake word viable at all in a page: keep
// the screen awake, the page stays foreground, and the microphone survives.
// Without the lock an "always listening" wake word dies the moment the phone
// dims - which is about fifteen seconds at a table.
//
// **The browser releases the lock itself** whenever the page is hidden, so
// holding it is not a one-shot: it has to be re-acquired on every
// `visibilitychange` back to visible, or it works exactly once.
//
// The lock is released for good when the panel closes, so the app never leaves
// a phone awake by itself.

let screenLock = null;
let screenLockWanted = false;

// --- the API microphone -----------------------------------------------------
//
// MediaRecorder -> a Blob -> transcribeAudio(). This is the path that makes the
// VOICE slot mean anything: until it existed, a configured voice model was
// stored, shown as "Configured" in Settings, and never called by a line of code
// in the app - `detectVoicePaths()` computed an 'api' branch that nothing
// implemented, in either direction.
//
// **The wake word cannot coexist with this, and that is the price.** Browser
// recognition runs continuously and raises an event on a phrase; a clip is
// recorded when the user asks and exists until it is sent. There is no event to
// hang a wake word on and nothing to transcribe until the user has stopped
// talking. So with a voice model configured the mic is press-and-hold, the
// wake word and continuous listening are off, and the panel says so rather than
// offering a toggle that cannot work.
//
// Two seams, for the same reason `setRecognitionFactory()` exists: neither a
// microphone nor a MediaRecorder exists in the harness, and the suite has to
// drive this end to end.

let streamFactory = null;
let recorderFactory = null;
let recording = null;

/** Injected so the suite can supply a recorder that is not Chrome's. */
export function setStreamFactory(fn) { streamFactory = fn; }
export function setRecorderFactory(fn) { recorderFactory = fn; }

/**
 * Whether this browser can record at all.
 *
 * Separate from whether a voice model is configured, because the two can
 * disagree in the direction that matters: a model set on a browser with no
 * microphone support still has to fall back to recognition rather than leave
 * the user with a dead button.
 */
export function canRecordAudio() {
    if (typeof navigator === 'undefined') return false;
    if (!navigator.mediaDevices || typeof navigator.mediaDevices.getUserMedia !== 'function') return false;
    if (typeof MediaRecorder === 'undefined') return false;
    return true;
}

export function isRecording() { return !!recording; }

function getStream() {
    const fn = streamFactory || ((c) => navigator.mediaDevices.getUserMedia(c));
    return fn({ audio: true });
}

function makeRecorder(stream) {
    // The seam is CALLED, not constructed - the same shape as
    // `setRecognitionFactory()`. An arrow function returning an instance is not
    // a constructor, and `new`-ing one throws in a way that reads as "this
    // browser cannot record" rather than "the seam is wrong".
    if (recorderFactory) {
        try { return recorderFactory(stream) || null; } catch { return null; }
    }
    const Ctor = typeof MediaRecorder !== 'undefined' ? MediaRecorder : null;
    if (!Ctor) return null;
    // Prefer a format the transcription endpoints accept as-is. Not every
    // browser offers webm, so this is a preference and not a requirement.
    const types = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg'];
    for (const type of types) {
        if (typeof Ctor.isTypeSupported === 'function' && Ctor.isTypeSupported(type)) {
            try { return new Ctor(stream, { mimeType: type }); } catch { /* try the next one */ }
        }
    }
    try { return new Ctor(stream); } catch { return null; }
}

/**
 * Start recording. Resolves true once audio is actually arriving.
 *
 * The permission prompt is why this is async and why the caller shows a state
 * before it settles: a user who has never granted the microphone gets a browser
 * dialog, and a button that does nothing while that is open reads as broken.
 */
export async function startRecording() {
    if (recording) return false;
    if (!canRecordAudio()) return false;

    let stream;
    try {
        stream = await getStream();
    } catch {
        return false;
    }
    if (!stream) return false;

    const rec = makeRecorder(stream);
    if (!rec) {
        for (const track of stream.getTracks?.() || []) track.stop();
        return false;
    }

    const chunks = [];
    rec.ondataavailable = (e) => { if (e?.data && e.data.size) chunks.push(e.data); };
    const state = { rec, stream, chunks, stopped: false };
    recording = state;

    try {
        rec.start();
    } catch {
        releaseRecording();
        return false;
    }
    return true;
}

/**
 * Stop and hand back the clip. Resolves to a Blob, or null if nothing usable
 * was captured - a tap that is too short should say so rather than POST an
 * empty body and surface a 400.
 */
export function stopRecording({ mimeType = 'audio/webm' } = {}) {
    const state = recording;
    if (!state) return Promise.resolve(null);
    return new Promise((resolve) => {
        let done = false;
        const finish = (blob) => {
            if (done) return;
            done = true;
            recording = null;
            for (const track of state.stream.getTracks?.() || []) track.stop();
            resolve(blob);
        };
        state.rec.onstop = () => {
            const blob = state.chunks.length ? new Blob(state.chunks, { type: mimeType }) : null;
            finish(blob && blob.size ? blob : null);
        };
        state.stopped = true;
        try { state.rec.stop(); } catch { finish(null); }
        // A recorder that never fires onstop must not wedge the button.
        setTimeout(() => finish(null), 2000);
    });
}

/** Drop whatever is in flight without producing a clip. */
export function releaseRecording() {
    const state = recording;
    recording = null;
    if (!state) return;
    try { state.rec.onstop = null; state.rec.stop(); } catch { /* not started */ }
    for (const track of state.stream.getTracks?.() || []) track.stop();
}

/** Whether this browser offers the API at all. */
export function isScreenLockSupported() {
    return typeof navigator !== 'undefined' && 'wakeLock' in navigator;
}

export function isScreenLockHeld() {
    return !!screenLock;
}

/**
 * Ask for the lock. Safe to call when one is already held.
 * @returns {Promise<boolean>} whether the lock is now held
 */
export async function acquireScreenLock({ request = null } = {}) {
    if (screenLock) return true;
    const ask = request
        || (typeof navigator !== 'undefined' && navigator.wakeLock
            ? navigator.wakeLock.request.bind(navigator.wakeLock)
            : null);
    if (!ask) return false;

    try {
        screenLock = await ask('screen');
    } catch {
        // Denied, or the document is not visible. Not worth showing anything:
        // the screen will simply sleep, which is what would have happened
        // anyway.
        screenLock = null;
        return false;
    }

    // The browser takes it away on its own schedule, and `release` is the only
    // notification we get - it is how we learn to re-acquire.
    try {
        screenLock?.addEventListener?.('release', () => { screenLock = null; });
    } catch { /* a handle without addEventListener is still usable */ }
    return true;
}

/** Let the screen sleep again, and stop trying to take the lock back. */
export function releaseScreenLock() {
    screenLockWanted = false;
    const held = screenLock;
    screenLock = null;
    if (held) { try { held.release?.(); } catch { /* already gone */ } }
}

/**
 * Keep the screen awake for as long as `wants` is true, re-acquiring whenever
 * the browser takes it back. This is the one the panel calls, kept separate
 * from acquire/release so the lifecycle lives here rather than at six call
 * sites.
 */
export function holdScreenLock(wants) {
    screenLockWanted = !!wants;
    if (!screenLockWanted) { releaseScreenLock(); return false; }
    if (!isScreenLockSupported()) return false;
    acquireScreenLock();
    return true;
}

if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
    document.addEventListener('visibilitychange', () => {
        if (!screenLockWanted) return;
        if (document.visibilityState !== 'visible') {
            // The browser is about to take it; let it, and remember we still
            // want it, so the handler below re-acquires on the way back.
            const held = screenLock;
            screenLock = null;
            if (held) { try { held.release?.(); } catch { /* already gone */ } }
            return;
        }
        if (!screenLock) acquireScreenLock();
    });
}

// --- the wake phrase --------------------------------------------------------
//
// "Hey Nova" and friends. A pure function, because it is the one piece of this
// feature that can be tested exhaustively without a microphone.
//
// Three things a recogniser hands back that a naive `startsWith` gets wrong:
// **case**, **accents** ("revez" for "revés"), and **punctuation and fillers**
// ("Okay, hey nova - push b" hides the phrase behind two things). So the
// comparison runs on folded, de-punctuated text, and only at the START - a
// wake word that fires mid-sentence is worse than no wake word at all.

/** The phrases out of the box. "Nova" is the app's name, so none of these need translating. */
export const DEFAULT_WAKE_PHRASES = ['hey nova', 'ok nova', 'nova'];

/** Strip accents and lower-case, for comparing what was heard to what we meant. */
export function foldSpeech(s) {
    return String(s ?? '')
        .toLowerCase()
        .normalize('NFKD')
        .replace(/[̀-ͯ]/g, '')
        .trim();
}

/**
 * Words people say before the thing they mean. Stripped before comparing, so
 * "Okay, hey nova - push b" still wakes. Deliberately CAPPED at
 * MAX_FILLERS: an unbounded strip would eat real words, and "muy bueno" must
 * not turn into a prefix match for every sentence that happens to start with
 * a greeting.
 */
const WAKE_FILLERS = new Set([
    'ok', 'okay', 'okey', 'hey', 'hola', 'bueno', 'buenas', 'bien', 'muy',
    'ehm', 'eh', 'ah', 'dale', 'venga', 'perfecto', 'listo', 'yeah', 'yep', 'yes'
]);
const MAX_FILLERS = 2;

/** Punctuation, including the inverted marks NFKD does not decompose. */
const PUNCTUATION = /[.,!?;:"'`´“”()\[\]{}¡¿…—–-]/g;

/**
 * Does `text` begin with a wake phrase?
 *
 * @param {string} text
 * @param {string[]} [phrases]
 * @returns {{phrase: string, rest: string, alone: boolean}|null}
 *          `rest` is what is left to act on; `alone` means the whole utterance
 *          WAS the wake word - which is "I am here", not "do something".
 */
export function matchWakePhrase(text, phrases = DEFAULT_WAKE_PHRASES) {
    const said = String(text ?? '').trim();
    if (!said) return null;

    // Fold accents and case, turn punctuation into spaces, and drop leading
    // fillers, so "¡Hey, Nova!" and "okay hey nova push b" both compare right.
    // Two parallel token lists: the FOLDED one is what we compare against the
    // phrases, the ORIGINAL one is what the user gets back. Folding is
    // lossy - it drops accents - and the transcript is the user's own words, so
    // handing back "saque al reves" for something they said as "saque al
    // revés" is a small lie about what was heard. Splitting the original on
    // the same punctuation keeps the two aligned, since folding never changes
    // how many tokens there are.
    const origTokens = said.replace(PUNCTUATION, ' ').split(/\s+/).filter(Boolean);
    const words = origTokens.map(tok => foldSpeech(tok)).filter(Boolean);

    const list = (Array.isArray(phrases) && phrases.length ? phrases : DEFAULT_WAKE_PHRASES)
        .map(p => foldSpeech(p).replace(PUNCTUATION, ' ').split(/\s+/).filter(Boolean).join(' '))
        .filter(Boolean)
        // Longest first, so "hey nova" is preferred over "nova" when both
        // match. Otherwise the short one always wins and the specific phrase
        // never gets a chance.
        .sort((a, b) => b.length - a.length);

    // Try the phrase at offset 0 FIRST, and only fall back to skipping
    // fillers. Stripping first looks equivalent and is not: "hey" is both a
    // filler AND the first word of the shipped phrase "hey nova", so a
    // strip-then-match matcher silently degraded every "hey nova" to "nova"
    // and the specific phrase could never fire. Matching first also means a
    // custom phrase is never eaten by the filler list.
    for (let start = 0; start <= MAX_FILLERS; start++) {
        if (start > 0 && !WAKE_FILLERS.has(words[start - 1])) break;

        for (const phrase of list) {
            const wanted = phrase.split(' ');
            if (words.slice(start, start + wanted.length).join(' ') !== phrase) continue;

            const used = start + wanted.length;
            // The ORIGINAL tokens from `used` onwards, not the folded ones.
            // If the two lists ever disagreed - a pathological fold - the
            // folded text is better than a mis-aligned splice, so fall back.
            const tail = origTokens.length === words.length
                ? origTokens.slice(used)
                : words.slice(used);
            const rest = tail.join(' ').replace(/[.,!?;:]+$/, '').trim();
            return { phrase, rest, alone: used >= words.length };
        }
    }
    return null;
}

let recognition = null;
let listening = false;

export function isListening() {
    return listening;
}

/**
 * Start listening. The callbacks are the seam the panel uses; none of them is
 * allowed to throw into the engine's event loop.
 */
export function startListening({
    lang = null,
    continuous = false,
    onInterim = null,
    onFinal = null,
    onError = null,
    onEnd = null
} = {}) {
    // Barge-in: the user is talking over the answer, so stop answering.
    stopSpeaking();

    let rec;
    try {
        rec = (recognitionFactory || defaultRecognitionFactory)();
    } catch {
        rec = null;
    }
    if (!rec) {
        onError?.(t('ai.voiceUnsupported'));
        onEnd?.();
        return null;
    }

    recognition = rec;
    listening = true;

    rec.lang = lang || getSpeechLang();
    rec.interimResults = true;
    // Armed mode listens across turns. The engine still ends the session on
    // its own schedule - Chrome stops after a pause - which is what the
    // auto-restart below exists for.
    rec.continuous = !!continuous;
    rec.maxAlternatives = 1;
    // The single biggest accuracy win for exactly this vocabulary.
    if ('phrases' in rec) {
        try { rec.phrases = voicePhrases(); } catch { /* not supported: harmless */ }
    }
    // On-device recognition is explicitly OFF, and this used to be explicitly
    // ON.
    //
    // The local engine is installed per LANGUAGE, so asking for it when Chrome
    // has no local model for this one answers `language-not-supported` - and
    // the cloud engine, Chrome's default and the one that actually works, is
    // never reached. It turned a working path into a hard failure, and then
    // reported it as the user's language being missing, which is what that
    // message means and is not what happened.
    //
    // It also contradicted the row above, which tells the user this browser
    // needs a connection for speech: that sentence describes the cloud engine,
    // which this was opting out of. Pinning it off matches what the app already
    // promises, and is deterministic rather than at the mercy of a browser or
    // user setting nobody can see. If on-device ever comes back it belongs here
    // - and behind a check that the model is actually installed, which the API
    // surface used here cannot do synchronously.
    if ('processLocally' in rec) {
        try { rec.processLocally = false; } catch { /* not supported: harmless */ }
    }

    const guard = (fn) => (e) => { try { fn(e); } catch { /* an engine callback must not throw */ } };

    rec.onresult = guard((event) => {
        let interim = '';
        let final = '';
        for (let i = event.resultIndex; i < event.results.length; i++) {
            const result = event.results[i];
            const text = result?.[0]?.transcript || '';
            if (result?.isFinal) final += text;
            else interim += text;
        }
        if (interim) onInterim?.(interim);
        if (final.trim()) onFinal?.(final.trim());
    });

    rec.onerror = guard((event) => {
        listening = false;
        // "no-speech" and "aborted" are what a user who changed their mind
        // looks like, not failures. Saying "sorry, something went wrong" to
        // somebody who simply stopped talking is worse than silence.
        const code = event?.error;
        if (code && code !== 'no-speech' && code !== 'aborted') {
            onError?.(voiceErrorText(code));
        }
    });

    rec.onend = guard(() => {
        listening = false;
        recognition = null;
        onEnd?.();
    });

    try {
        rec.start();
    } catch (err) {
        // start() throws if it is already running - a double tap on the mic.
        listening = false;
        onError?.(t('ai.voiceErrorGeneric'));
    }
    return rec;
}

export function stopListening() {
    if (!recognition) return;
    try { recognition.stop(); } catch { /* already stopped */ }
}

/**
 * The API speech-in path.
 *
 * **There are two different wire formats here, and picking the wrong one is a
 * 404 rather than an error.** This was found the hard way: a live call against
 * OpenRouter returned "no such endpoint" for a perfectly valid model, and the
 * reason was the request shape, not the model.
 *
 *  - **OpenAI** (`/audio/transcriptions`): `multipart/form-data` with a `file`
 *    part, and **no** `Content-Type` of your own - the browser has to add the
 *    multipart boundary, and setting the header by hand produces a body the
 *    server cannot parse.
 *  - **OpenRouter** (`/audio/transcriptions`): `application/json` with the
 *    audio as base64 in `input_audio: { data, format }`. No file upload.
 *
 * So the format is selected by provider rather than guessed, and each one is
 * tested. Note that OpenRouter does NOT list its transcription models in
 * `GET /models` - that endpoint only covers chat models - so "it is not in the
 * list" is not evidence that a transcription model does not work.
 *
 * `fetchImpl` is injected, like the text client, so this is testable.
 *
 * @param {Blob|File} blob
 */
export async function transcribeAudio(blob, { slot = null, fetchImpl = null, language = null, prompt = '' } = {}) {
    const useSlot = slot || resolveVoiceSlot();
    if (!isVoiceConfigured() && !useSlot?.apiKey) throw new Error(t('ai.needKey'));

    const doFetch = fetchImpl || (typeof fetch === 'function' ? fetch : null);
    if (!doFetch) throw new Error(t('ai.voiceUnsupported'));

    const url = transcriptionsUrl(useSlot);
    if (!url) throw new Error(t('ai.voiceUnsupported'));

    const openRouterShape = useSlot.provider === 'openrouter';
    let body, headers;

    if (openRouterShape) {
        const bytes = new Uint8Array(await blob.arrayBuffer());
        let binary = '';
        for (const byte of bytes) binary += String.fromCharCode(byte);
        headers = buildHeaders(useSlot);
        body = {
            model: useSlot.model,
            input_audio: { data: btoa(binary), format: audioFormat(blob) },
            ...(language ? { language } : {}),
            ...(prompt ? { prompt } : {})
        };
    } else {
        const form = new FormData();
        form.append('file', blob, 'clip.webm');
        form.append('model', useSlot.model);
        if (language) form.append('language', language);
        if (prompt) form.append('prompt', prompt);
        // Deliberately NOT setting Content-Type: the browser must add the
        // multipart boundary itself.
        headers = buildHeaders(useSlot, { json: false });
        body = form;
    }

    // The JSON shape has to be SERIALISED. Handing `fetch` a plain object
    // makes it coerce the body, and the endpoint answers "expected object,
    // received array" - which looks exactly like a bad model id and is not
    // one. Found against the live endpoint, not by a fake.
    const res = await doFetch(url, {
        method: 'POST',
        headers,
        body: openRouterShape ? JSON.stringify(body) : body
    });
    if (!res.ok) {
        // Redacted on the way through: an upstream that echoes the Authorization
        // header into its error body is a real thing.
        let detail = '';
        try { detail = (await res.text()).slice(0, 300); } catch { /* unreadable */ }
        throw new Error(`HTTP ${res.status}${detail ? `: ${redact(detail, [useSlot.apiKey])}` : ''}`);
    }

    const data = await res.json();
    const text = typeof data?.text === 'string' ? data.text.trim() : '';
    if (!text) throw new Error(t('ai.voiceNothingHeard'));
    return text;
}

/**
 * The format hint an audio blob needs. These are the values the transcription
 * APIs expect, and they are container names, not MIME types - a browser giving
 * us `audio/webm;codecs=opus` has to become plain `webm`.
 */
export function audioFormat(blob) {
    const type = String(blob?.type || '').toLowerCase();
    if (type.includes('wav')) return 'wav';
    if (type.includes('ogg')) return 'ogg';
    if (type.includes('mp3') || type.includes('mpeg')) return 'mp3';
    if (type.includes('m4a') || type.includes('mp4') || type.includes('aac')) return 'm4a';
    if (type.includes('flac')) return 'flac';
    return 'webm';
}

// --- speech out -------------------------------------------------------------

let speaking = false;

export function isSpeaking() {
    return speaking;
}

/**
 * Say something. `speechSynthesis` by default: offline, free, no key, and it
 * degrades to silence rather than an error when no voice is installed.
 */
/**
 * Cut a reply down to what a person actually wants to read or hear.
 *
 * The prompt already asks for one or two sentences, and the model mostly
 * obeys. When it does not, the reply arrived as a full markdown table of the
 * drill that is ALREADY rendered, in full, three lines above it - and then a
 * bulleted menu of next steps. Reading that out loud is the worst version of
 * it. A prompt is a request; this is the consequence.
 *
 * Two sentences, and a hard character ceiling so a single rambling sentence
 * cannot get through either. Kept whole sentences, so the reply never stops
 * mid-clause - which is the thing that makes a spoken reply sound broken.
 */
export function shortReply(text) {
    const clean = plainForSpeech(text);
    if (!clean) return '';

    const LIMIT = 260;
    if (clean.length <= LIMIT) return clean;

    // A sentence ends after a LETTER. Matching a bare '.' finds the one in
    // "1. Probarlo" - the numbered menu the reply is supposed to not have -
    // and cuts halfway into it, which is the exact failure this exists to
    // prevent: a spoken reply that stops mid-list sounds broken rather than
    // short. So the terminator has to be preceded by a word character.
    const cut = clean.slice(0, LIMIT);
    let end = 0;
    // Two things this regex has to get right, and got wrong twice:
    //  - `\s?!` is NOT "space then ! or ?" - the `?` binds to `\s` as a
    //    quantifier, so the branch only ever matched `!` and every question
    //    mark was invisible to the cut.
    //  - No DIGITS. "1. Probarlo" is not a sentence, and with digits in the
    //    class the cut landed inside the numbered menu - the very thing it
    //    exists to remove - and stopped there instead.
    for (const m of cut.matchAll(/[A-Za-zÀ-ÿ)"'][.!?](?=\s|$)/g)) end = m.index + 1;

    // No sentence ends inside the ceiling. Then cut at a WORD boundary, not a
    // character one: "... twelve muy largo" already reads as broken, and the
    // whole reason for the cap is to avoid that.
    if (end <= 40) return cut.slice(0, cut.lastIndexOf(' ')).trim();
    return clean.slice(0, end).trim();
}


/**
 * Strip everything structural out of a reply before it is SPOKEN.
 *
 * This is the guarantee behind the prompt's request for short replies, not a
 * second copy of it. A prompt says "no tables"; a prompt is a suggestion to a
 * model that is trying to be helpful, and a helpful assistant reaches for a
 * table. The app then reads that table out loud - a column header, then
 * fragments with no meaning between them - which is worse than silence because
 * it sounds broken rather than absent.
 *
 * What goes: fenced blocks, table rows, headings, list bullets, emphasis and
 * link syntax, and any leftover pipe or hash. What stays is the sentence. If
 * stripping leaves nothing, the caller is told so and says nothing rather than
 * reading a table aloud.
 */
export function plainForSpeech(text) {
    let out = String(text ?? '');
    if (!out.trim()) return '';

    // Fenced code: drop the fences and their contents entirely.
    out = out.replace(/```[\s\S]*?```/g, ' ');
    // Table rows: any line that is mostly pipes. A row and its header are both
    // noise spoken aloud.
    out = out.split('\n').filter(line => {
        const ticks = (line.match(/\|/g) || []).length;
        return ticks < 2;
    }).join('\n');
    // Headings, blockquote and list markers, at the start of a line.
    out = out.replace(/^\s{0,3}#{1,6}\s+/gm, '');
    out = out.replace(/^\s{0,3}>\s?/gm, '');
    out = out.replace(/^\s*[-*+]\s+/gm, '');
    out = out.replace(/^\s*\d+[.)]\s+/gm, '');
    // Emphasis and inline code and links.
    out = out.replace(/\*\*([^*]+)\*\*/g, '$1').replace(/__([^_]+)__/g, '$1');
    out = out.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1$2');
    out = out.replace(/`([^`]+)`/g, '$1');
    out = out.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1');
    // Horizontal rules and leftover decoration.
    out = out.replace(/^\s*([-*_])\s*(\1\s*){2,}$/gm, ' ');
    out = out.replace(/[|#]/g, ' ');
    out = out.replace(/[ \t]{2,}/g, ' ');
    out = out.replace(/\n{3,}/g, '\n\n');
    return out.replace(/\s+/g, ' ').trim();
}

export function speak(text, { lang = null, rate = 1.02, onDone = null } = {}) {
    // Nothing structural ever reaches the speaker.
    const say = plainForSpeech(text);
    if (!say) return false;
    if (!getAiConfig().speak) return false;
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return false;

    stopSpeaking();
    try {
        const utter = new window.SpeechSynthesisUtterance(say);
        utter.lang = lang || getSpeechLang();
        utter.rate = rate;
        const done = () => { speaking = false; try { onDone?.(); } catch { /* a render must not throw */ } };
        utter.onstart = () => { speaking = true; };
        utter.onend = done;
        utter.onerror = done;
        window.speechSynthesis.speak(utter);
        // Marked speaking HERE, not on `onstart`. `onstart` is an event some
        // engines do not fire promptly, and a cancelled or instantly-failing
        // utterance may never fire it at all - and `speaking` is what puts the
        // stop control on screen. Waiting for the event meant a reply the user
        // could not interrupt was also one they could not see they could not
        // interrupt.
        speaking = true;
        return true;
    } catch {
        speaking = false;
        return false;
    }
}

// --- armed (wake word) mode -------------------------------------------------
//
// "Always listening" in a page, with the honest caveats baked in rather than
// buried: the browser decides when to stop the microphone, so this restarts it,
// and the whole thing only works while the page is in the foreground with the
// screen awake. `holdScreenLock()` is what buys that.
//
// Everything said while armed is DISCARDED unless it starts with a wake
// phrase. Showing every stray sentence in the transcript would make the panel
// unusable, and acting on them would be worse.

let armed = false;
let armedOpts = null;
let restartTimer = null;

/** How long to wait before asking for the microphone again after the engine stops. */
const RESTART_DELAY_MS = 250;

export function isArmed() {
    return armed;
}

/**
 * Stay listening until `disarm()`.
 *
 * @param {object} [options]
 * @param {string[]} [options.phrases]  wake phrases; defaults to DEFAULT_WAKE_PHRASES
 * @param {Function} [options.onWake]   ({rest, alone, phrase}) => void
 * @param {Function} [options.onState]  (listening: boolean) => void
 * @param {Function} [options.onError]  (message: string) => void
 */
export function arm({ phrases = null, onWake = null, onState = null, onError = null } = {}) {
    if (armed) return true;
    armed = true;
    armedOpts = {
        phrases: Array.isArray(phrases) && phrases.length ? phrases : DEFAULT_WAKE_PHRASES,
        onWake, onState, onError
    };

    // The whole point of the feature: keep the screen on so the browser does
    // not suspend the microphone we are about to ask for.
    holdScreenLock(true);
    listenOnce();
    return true;
}

function listenOnce() {
    if (!armed) return;
    startListening({
        continuous: true,
        onInterim: (text) => armedOpts?.onState?.(true, text),
        onFinal: (text) => {
            if (!armed) return;
            const hit = matchWakePhrase(text, armedOpts?.phrases);
            // No wake phrase: the user was talking to somebody else, or to
            // themselves. Drop it on the floor and keep listening.
            if (!hit) return;
            armedOpts?.onWake?.(hit);
        },
        onError: (message) => {
            if (!armed) return;
            armedOpts?.onError?.(message);
            // A permission refusal is not going to fix itself, and retrying it
            // in a loop would be a mic light blinking forever.
            if (/microphone|mic|permiso|access/i.test(message)) disarm();
        },
        onEnd: () => {
            armedOpts?.onState?.(false);
            if (!armed) return;
            // The engine ended the session. Chrome does this on its own after
            // a pause, so the restart is the normal path, not an error path.
            clearTimeout(restartTimer);
            restartTimer = setTimeout(listenOnce, RESTART_DELAY_MS);
        }
    });
}

/** Stop listening and give the screen back. */
export function disarm() {
    if (!armed) return false;
    armed = false;
    armedOpts = null;
    clearTimeout(restartTimer);
    restartTimer = null;
    stopListening();
    holdScreenLock(false);
    return true;
}

/** Stop mid-sentence. Used by barge-in and by closing the panel. */
export function stopSpeaking() {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
    try {
        window.speechSynthesis.cancel();
    } catch { /* nothing queued */ }
    speaking = false;
}

// --- lifecycle --------------------------------------------------------------

/** The panel calls this when it closes: no microphone, no voice, no leak. */
export function releaseVoice() {
    disarm();
    stopListening();
    stopSpeaking();
    holdScreenLock(false);
}
