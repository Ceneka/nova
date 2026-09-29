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
export function detectVoicePaths() {
    const hasRecognition = typeof window !== 'undefined'
        && !!(window.SpeechRecognition || window.webkitSpeechRecognition);
    const hasSynthesis = typeof window !== 'undefined' && 'speechSynthesis' in window;
    const api = isVoiceConfigured();

    VOICE_PATHS.stt = hasRecognition ? 'browser' : (api ? 'api' : 'none');
    VOICE_PATHS.tts = hasSynthesis ? 'browser' : (api ? 'api' : 'none');

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
    rec.continuous = false;
    rec.maxAlternatives = 1;
    // The single biggest accuracy win for exactly this vocabulary.
    if ('phrases' in rec) {
        try { rec.phrases = voicePhrases(); } catch { /* not supported: harmless */ }
    }
    // Opt in to on-device recognition when the browser offers it.
    if ('processLocally' in rec) {
        try { rec.processLocally = true; } catch { /* not supported */ }
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
export function speak(text, { lang = null, rate = 1.02 } = {}) {
    const say = String(text || '').trim();
    if (!say) return false;
    if (!getAiConfig().speak) return false;
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return false;

    stopSpeaking();
    try {
        const utter = new window.SpeechSynthesisUtterance(say);
        utter.lang = lang || getSpeechLang();
        utter.rate = rate;
        utter.onstart = () => { speaking = true; };
        utter.onend = () => { speaking = false; };
        utter.onerror = () => { speaking = false; };
        window.speechSynthesis.speak(utter);
        return true;
    } catch {
        speaking = false;
        return false;
    }
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
    stopListening();
    stopSpeaking();
}
