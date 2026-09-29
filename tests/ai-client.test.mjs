/**
 * The model tier, driven entirely against a fake endpoint.
 *
 * `aiClient.js` takes its `fetch` by injection, which is what makes this file
 * possible: no key, no network, no browser, and full control over the two
 * things that actually break a client - a chunk boundary that lands in the
 * middle of a tool call, and a model that never stops calling tools.
 *
 * These are the cases the plan calls out in §14, plus the redaction promise,
 * which is the one worth being paranoid about: the key must not appear in an
 * error message, a log, or anything else that could end up in a screenshot.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

const store = new Map();
globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
    clear: () => store.clear()
};

const CFG = await import('../js/aiConfig.js');
const CLI = await import('../js/aiClient.js');
const A = await import('../js/aiAgent.js');
const T = await import('../js/aiTerms.js');

const KEY = 'sk-or-v1-THISISASECRETVALUE1234';
const SLOT = {
    provider: 'custom',
    baseUrl: 'https://example.invalid/api/v1',
    apiKey: KEY,
    model: 'test-model'
};

/**
 * A fake endpoint.
 *
 * `script` is a list of responses handed out one per call; the last one
 * repeats. `rawChunks` returns a list of byte-ish strings to serve as a body,
 * which is how a chunk boundary is put exactly where it hurts.
 */
function fakeFetch(script = [], { rawChunks = null } = {}) {
    const calls = [];
    let i = 0;
    const impl = async (url, init) => {
        calls.push({ url, init, body: init?.body ? JSON.parse(init.body) : null });
        if (rawChunks) return streamOf(rawChunks);
        const step = script[Math.min(i, script.length - 1)];
        i++;
        if (typeof step === 'function') return step(calls.length);
        // `sse` steps are served as a real stream, because streaming is the
        // DEFAULT and a test that only ever exercised the non-streaming branch
        // would leave the interesting parser untested.
        if (step && step.sse) return streamOf(step.sse);
        return jsonOf(step);
    };
    impl.calls = calls;
    return impl;
}

function jsonOf(payload, { status = 200 } = {}) {
    return {
        ok: status >= 200 && status < 300,
        status,
        json: async () => payload,
        text: async () => JSON.stringify(payload)
    };
}

function streamOf(chunks, { status = 200 } = {}) {
    const encoder = new TextEncoder();
    let at = 0;
    return {
        ok: status >= 200 && status < 300,
        status,
        body: {
            getReader: () => ({
                read: async () => (at < chunks.length
                    ? { done: false, value: encoder.encode(chunks[at++]) }
                    : { done: true, value: undefined }),
                cancel: async () => {}
            })
        },
        text: async () => chunks.join(''),
        json: async () => JSON.parse(chunks.join(''))
    };
}

/** A `data:` line, the way a real SSE stream carries one. */
const sse = (obj) => `data: ${JSON.stringify(obj)}\n\n`;
const DONE = 'data: [DONE]\n\n';

const userMessage = [{ role: 'user', content: 'a short backspin serve to the forehand' }];

// --- configuration ----------------------------------------------------------

test('configuration normalizes, and a junk store is not fatal', () => {
    for (const junk of [null, undefined, 42, 'nope', [], { text: 'no' }, { text: { provider: 'evil' } }]) {
        const c = CFG.normalizeConfig(junk);
        assert.ok(c.text && c.voice, `normalized: ${JSON.stringify(junk)}`);
        assert.equal(c.text.provider, 'openrouter', 'an unknown provider falls back');
    }
    // Off by default: history is per session unless the user turns it on.
    assert.equal(CFG.normalizeConfig({}).remember, false);
    assert.equal(CFG.normalizeConfig({}).voice.mode, 'follow-text');
});

test('endpoints are built from the base URL and nothing else', () => {
    assert.equal(CFG.chatUrl(SLOT), 'https://example.invalid/api/v1/chat/completions');
    assert.equal(CFG.modelsUrl(SLOT), 'https://example.invalid/api/v1/models');
    // a trailing slash, and a base that already names the path
    assert.equal(CFG.chatUrl({ baseUrl: 'https://x.test/v1/' }), 'https://x.test/v1/chat/completions');
    assert.equal(CFG.chatUrl({ baseUrl: 'https://x.test/v1/chat/completions' }), 'https://x.test/v1/chat/completions');
    assert.equal(CFG.chatUrl({ baseUrl: '' }), '');
});

test('the key goes in the Authorization header and nowhere else', () => {
    const headers = CFG.buildHeaders(SLOT);
    assert.equal(headers.Authorization, `Bearer ${KEY}`);
    assert.equal(headers['Content-Type'], 'application/json');
    // ...and not in the URL, which is the mistake that leaks a key into a
    // server access log, a proxy log, and a Referer header.
    assert.ok(!CFG.chatUrl(SLOT).includes(KEY));
});

// --- redaction --------------------------------------------------------------

test('the key is redacted on every path that could show text', () => {
    const masked = CFG.maskKey(KEY);
    assert.ok(!masked.includes('THISISASECRET'), masked);
    assert.ok(masked.endsWith('1234'), 'the last four stay, so two keys can be told apart');

    // The redaction is applied with the key the request was actually sent
    // with, which is not always the stored one - chat() takes a slot by
    // argument, so redacting only the stored key would leave THIS one in the
    // message.
    assert.equal(CFG.redact(`sent ${KEY}`, [KEY]).includes('THISISASECRET'), false);
    // ...and every text path the assistant could show goes through it.
    for (const leak of [
        `Request failed with key ${KEY}`,
        `Bearer ${KEY}`,
        { error: `bad key ${KEY}` }
    ]) {
        const out = CFG.redact(leak, [KEY]);
        assert.ok(!String(out).includes('THISISASECRET'), `leaked in: ${JSON.stringify(out)}`);
    }
});

// --- SSE parsing ------------------------------------------------------------

test('a chunk boundary in the middle of a tool call does not lose the call', async () => {
    // The failure this guards: a naive split on "\n" throws away the half of
    // the JSON that landed at the end of one read, and the assistant then
    // silently does nothing while looking perfectly healthy.
    const call = {
        id: 'call_1',
        type: 'function',
        function: { name: 'compose_drill', arguments: '{"name":"x","steps":[{"role":"push"}]}' }
    };
    const body =
        sse({ choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_1', function: { name: 'compose_drill' } }] } }] }) +
        // the arguments arrive in two pieces, and the split lands mid-string
        sse({ choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '{"name":"x","ste' } }] } }] }) +
        sse({ choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: 'ps":[{"role":"push"}]}' } }] } }] }) +
        sse({ choices: [{ delta: {}, finish_reason: 'tool_calls' }] }) +
        DONE;

    // ...and cut it at a byte offset that is deliberately mid-token.
    const half = Math.floor(body.length / 2);
    const res = await CLI.chat({
        messages: userMessage, slot: SLOT, fetchImpl: fakeFetch([], { rawChunks: [body.slice(0, half), body.slice(half)] })
    });

    assert.equal(res.toolCalls.length, 1, 'the tool call survived the split');
    assert.equal(res.toolCalls[0].function.name, 'compose_drill');
    assert.deepEqual(JSON.parse(res.toolCalls[0].function.arguments), { name: 'x', steps: [{ role: 'push' }] });
});

test('streamed prose arrives incrementally', async () => {
    const body =
        sse({ choices: [{ delta: { content: 'I will ' } }] }) +
        sse({ choices: [{ delta: { content: 'use your ' } }] }) +
        sse({ choices: [{ delta: { content: 'Safe push.' } }] }) +
        sse({ choices: [{ delta: {}, finish_reason: 'stop' }] }) +
        DONE;

    const seen = [];
    const res = await CLI.chat({
        messages: userMessage, slot: SLOT, stream: true,
        fetchImpl: fakeFetch([], { rawChunks: [body] }),
        onText: (text) => seen.push(text)
    });

    assert.equal(res.text, 'I will use your Safe push.');
    // The panel gets every partial, not just the final string - that is the
    // difference between "thinking" and "hung".
    assert.ok(seen.length >= 3, `${seen.length} partials`);
    assert.ok(seen[seen.length - 1].endsWith('Safe push.'));
});

test('a non-streaming endpoint works with one flag', async () => {
    const res = await CLI.chat({
        messages: userMessage, slot: SLOT, stream: false,
        fetchImpl: fakeFetch([{
            choices: [{ message: { content: 'pong' }, finish_reason: 'stop' }],
            usage: { total_tokens: 12 }
        }])
    });
    assert.equal(res.text, 'pong');
    assert.equal(res.usage.total_tokens, 12);
});

test('a malformed SSE event is dropped, not thrown', async () => {
    const body = 'data: {not json\n\n' + sse({ choices: [{ delta: { content: 'ok' } }] }) + DONE;
    const res = await CLI.chat({
        messages: userMessage, slot: SLOT, fetchImpl: fakeFetch([], { rawChunks: [body] })
    });
    assert.equal(res.text, 'ok', 'one bad chunk does not lose the reply');
});

// --- errors -----------------------------------------------------------------

test('HTTP failures map to stable codes and never carry the key', async () => {
    for (const [status, code] of [[401, 'unauthorized'], [403, 'unauthorized'], [429, 'rate-limited'], [500, 'http']]) {
        const impl = async () => ({
            ok: false, status,
            text: async () => `upstream rejected Authorization: Bearer ${KEY}`,
            json: async () => ({})
        });
        const err = await CLI.chat({ messages: userMessage, slot: SLOT, fetchImpl: impl })
            .then(() => null, e => e);
        assert.ok(err, `HTTP ${status} threw`);
        assert.equal(err.code, code, `HTTP ${status} -> ${err.code}`);
        assert.ok(!err.message.includes('THISISASECRET'), `HTTP ${status} leaked the key: ${err.message}`);
    }
});

test('a network failure is a failure, not a hang', async () => {
    const err = await CLI.chat({
        messages: userMessage, slot: SLOT,
        fetchImpl: async () => { throw new Error('ECONNREFUSED'); }
    }).then(() => null, e => e);
    assert.equal(err.code, 'network');
    assert.ok(/ECONNREFUSED/.test(err.message));
});

test('an aborted request stops promptly', async () => {
    const controller = new AbortController();
    const impl = (url, init) => new Promise((resolve, reject) => {
        init.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
        setTimeout(() => resolve(jsonOf({})), 5000);
    });
    const p = CLI.chat({ messages: userMessage, slot: SLOT, fetchImpl: impl, signal: controller.signal });
    setTimeout(() => controller.abort(), 10);
    const err = await p.then(() => null, e => e);
    assert.ok(err, 'an abort rejects rather than resolving');
    assert.equal(err.code, 'timeout');
});

// --- the agent loop ---------------------------------------------------------

/** A streamed tool-call turn, then a streamed text turn. */
function agentScript(toolName, args) {
    return [
        { sse: [
            sse({
                choices: [{
                    delta: {
                        tool_calls: [{
                            index: 0, id: 'call_1',
                            function: { name: toolName, arguments: JSON.stringify(args) }
                        }]
                    },
                    finish_reason: 'tool_calls'
                }],
                usage: { total_tokens: 20 }
            }),
            DONE
        ] },
        { sse: [
            sse({ choices: [{ delta: { content: 'Done. I used your Safe push.' }, finish_reason: 'stop' }] }),
            DONE
        ] }
    ];
}

/** A model that calls the same tool on every turn, forever. */
function loopingScript() {
    return [{ sse: [
        sse({
            choices: [{
                delta: {
                    tool_calls: [{ index: 0, id: 'c', function: { name: 'list_presets', arguments: '{}' } }]
                },
                finish_reason: 'tool_calls'
            }]
        }),
        DONE
    ] }];
}

test('a clean tool round runs, reports, and stops', async () => {
    const fetchImpl = fakeFetch(agentScript('compose_drill', {
        name: 'Push drill',
        steps: [{ role: 'push', side: 'bh' }]
    }));

    const seen = [];
    const res = await CLI.runAgent({
        messages: userMessage,
        tools: A.TOOLS,
        handleTool: (name, args) => {
            seen.push([name, args]);
            return { ok: true };
        },
        fetchImpl,
        slot: SLOT,
        language: 'en'
    });

    assert.equal(seen.length, 1);
    assert.equal(seen[0][0], 'compose_drill');
    assert.deepEqual(seen[0][1], { name: 'Push drill', steps: [{ role: 'push', side: 'bh' }] });
    assert.equal(res.text, 'Done. I used your Safe push.');
    assert.equal(res.stopped, 'done');
    assert.equal(fetchImpl.calls.length, 2, 'two requests: the tool round and the answer');
    // The tool result is fed back, or the model has no idea what happened.
    assert.ok(res.messages.some(m => m.role === 'tool'));
});

test('the 8-round cap fires on a model that never stops calling tools', async () => {
    // A model that calls a tool on every turn would otherwise loop forever.
    const fetchImpl = fakeFetch(loopingScript());

    const res = await CLI.runAgent({
        messages: userMessage,
        tools: A.TOOLS,
        handleTool: () => ({ ok: true }),
        fetchImpl,
        slot: SLOT,
        maxRounds: 8
    });

    assert.equal(res.rounds, 8);
    assert.equal(res.stopped, 'max-rounds');
    assert.equal(fetchImpl.calls.length, 8, 'exactly eight requests, not nine and not infinite');
});

test('a tool the model invented is reported, never executed', async () => {
    let executed = 0;
    const fetchImpl = fakeFetch(agentScript('delete_everything', { path: '/' }));
    const res = await CLI.runAgent({
        messages: userMessage,
        tools: A.TOOLS,
        handleTool: () => { executed++; return { ok: true }; },
        fetchImpl,
        slot: SLOT
    });

    assert.equal(executed, 0, 'a hallucinated tool name runs nothing');
    const fedBack = res.messages.find(m => m.role === 'tool');
    assert.match(fedBack.content, /No such tool/);
});

test('a tool that throws is reported back, not fatal', async () => {
    // A tool that cannot find something is a normal outcome the model should
    // be told about, not a reason to end the conversation.
    const fetchImpl = fakeFetch(agentScript('get_drill', { key: 'nope' }));
    const res = await CLI.runAgent({
        messages: userMessage,
        tools: A.TOOLS,
        handleTool: () => { throw new Error('storage unavailable'); },
        fetchImpl,
        slot: SLOT
    });
    const fedBack = res.messages.find(m => m.role === 'tool');
    assert.match(fedBack.content, /storage unavailable/);
    assert.match(res.text, /Done/);
});

test('the total timeout stops a slow turn', async () => {
    // The fake honours the abort signal, because a real fetch does - which is
    // the whole reason the AbortController is there. A promise that ignores
    // its signal cannot be cancelled by anything, including the timeout.
    const slow = (url, init) => new Promise((resolve, reject) => {
        init.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
    });
    const res = await CLI.runAgent({
        messages: userMessage,
        tools: A.TOOLS,
        handleTool: () => ({}),
        fetchImpl: slow,
        slot: SLOT,
        totalTimeoutMs: 30
    }).then(() => ({ stopped: 'not-thrown' }), e => ({ stopped: e.code }));

    assert.ok(res.stopped, 'a turn that never answers does not hang the panel');
});

test('the system prompt carries the same vocabulary the parser uses', () => {
    const prompt = CLI.systemPrompt({ language: 'es' });
    for (const role of T.ROLES) assert.ok(prompt.includes(role), `the prompt offers "${role}"`);
    for (const side of T.SIDES) assert.ok(prompt.includes(side), `the prompt offers "${side}"`);
    // The two facts a model gets wrong most often, stated explicitly.
    assert.match(prompt, /NEGATIVE drop/);
    assert.match(prompt, /never produce numbers/i);
    assert.match(prompt, /Spanish/);
});

// --- the tools --------------------------------------------------------------

test('normalizeIntent refuses an intent with no role, and clamps the rest', () => {
    assert.equal(A.normalizeIntent(null), null);
    assert.equal(A.normalizeIntent('push'), null);
    assert.equal(A.normalizeIntent({ role: 'nuke' }), null, 'an unknown role is not a role');

    const wild = A.normalizeIntent({
        role: 'drive', speed: 99, intensity: 9999, bpm: 5000, reps: -3,
        scatter: 'yes', variants: 'chaos', note: 'x'.repeat(900)
    });
    assert.equal(wild.role, 'drive');
    assert.equal(wild.intensity, 10, 'intensity is capped');
    assert.equal(wild.bpm, 90, 'bpm is clamped into the table\'s range');
    assert.equal(wild.reps, 1, 'a negative repetition count is not a repetition');
    assert.equal(wild.scatter, false, 'scatter is opt-in and boolean');
    assert.equal(wild.variants, null, 'an unknown variants mode is dropped');
    assert.equal(wild.note.length, 200, 'free text is length-capped');
    // ...and the field the model invented for itself is simply not there.
    assert.equal(wild.speed, undefined);
});

test('there is no tool that can write a ball or reach the drill store', () => {
    // The whole design in one assertion. If a future change adds a tool that
    // takes a speed or writes currentDrills, this is the check that says no.
    const names = A.TOOLS.map(t => t.function.name);
    for (const forbidden of ['set_ball', 'set_speed', 'write_drill', 'set_drill', 'edit_drill']) {
        assert.ok(!names.includes(forbidden), `there is no ${forbidden}`);
    }
    // Only compose_draft-family tools produce steps, and they all go through
    // aiCompile, which goes through makeBall.
    const producers = names.filter(n => /compose|update_draft|create_preset/.test(n));
    assert.ok(producers.length >= 2);

    // And the confirmation policy is one list, not a convention.
    for (const destructive of ['delete_preset', 'clear_ia_drills', 'delete_ai_drill', 'update_preset']) {
        assert.ok(A.CONFIRM.has(destructive), `${destructive} needs a confirmation`);
    }
    assert.ok(!A.CONFIRM.has('play_draft'), 'playing a draft is free by design');
    assert.ok(!A.CONFIRM.has('compose_drill'), 'composing a draft is free by design');
});

test('a model-authored name is cut on a word, not mid-word', async () => {
    // This one came from a real draft against a real model: a 40-character
    // slice produced "Push suave al reves + drive fuerte a la ", which reads as
    // a bug rather than as a limit. compose_drill is the path it happened on.
    store.clear();
    P_reset();
    const handlers = A.makeToolHandlers({});
    const long = 'Push suave al reves y despues un drive fuerte a la derecha con top';
    const made = await handlers.compose_drill({
        name: long,
        steps: [{ role: 'push', side: 'bh', intensity: 3 }, { role: 'drive', side: 'fh', intensity: 8 }]
    });
    assert.ok(!made.error, JSON.stringify(made));

    const { getDraft } = await import('../js/aiStore.js');
    const draft = getDraft();
    assert.ok(draft.name.length <= 40, draft.name);
    assert.ok(!/\s$/.test(draft.name), `no trailing space: "${draft.name}"`);
    assert.ok(!/\b(?:la|al|a|con|un)$/.test(draft.name), `no dangling word: "${draft.name}"`);
    // ...and it is still recognisably the name the model gave.
    assert.ok(draft.name.startsWith('Push suave'), draft.name);

    // A short name is untouched.
    const short = await handlers.compose_drill({ name: 'Corto', steps: [{ role: 'push' }] });
    assert.equal(getDraft().name, 'Corto');

    // A single word with no spaces in it is still bounded, rather than
    // collapsing to nothing because there is nowhere to cut.
    const huge = await handlers.compose_drill({ name: 'z'.repeat(200), steps: [{ role: 'push' }] });
    assert.equal(getDraft().name.length, 40, getDraft().name);
});

test('the API speech-in path has TWO wire formats, and picks by provider', async () => {
    // Found the hard way against a live endpoint: a valid model id returned
    // "no such endpoint" for what turned out to be the wrong REQUEST SHAPE, not
    // a bad model. OpenAI takes multipart with a file part; OpenRouter takes
    // JSON with base64 input_audio. Guessing between them is a 404.
    const V = await import('../js/aiVoice.js');
    globalThis.btoa = (s) => Buffer.from(s, 'binary').toString('base64');
    globalThis.FormData = class {
        constructor() { this.parts = []; }
        append(k, v) { this.parts.push([k, v]); }
    };

    const clip = {
        type: 'audio/wav;codecs=opus',
        arrayBuffer: async () => new Uint8Array([1, 2, 3, 4]).buffer
    };
    assert.equal(V.audioFormat(clip), 'wav', 'a mime type with parameters still names its container');

    const seen = [];
    const capture = () => async (url, init) => {
        seen.push({ url, init });
        return { ok: true, status: 200, json: async () => ({ text: 'saque corto' }) };
    };

    const viaOpenRouter = await V.transcribeAudio(clip, {
        slot: { provider: 'openrouter', baseUrl: 'https://x.test/v1', apiKey: 'k'.repeat(12), model: 'm' },
        language: 'es',
        fetchImpl: capture()
    });
    assert.equal(viaOpenRouter, 'saque corto');
    const or = seen.pop();
    assert.equal(or.url, 'https://x.test/v1/audio/transcriptions');
    assert.equal(or.init.headers['Content-Type'], 'application/json');
    // The bug this whole test exists for: a plain object handed to fetch is
    // coerced, and the endpoint answers "expected object, received array".
    assert.equal(typeof or.init.body, 'string', 'the JSON body is serialised');
    const sent = JSON.parse(or.init.body);
    assert.deepEqual(sent.input_audio, { data: Buffer.from([1, 2, 3, 4]).toString('base64'), format: 'wav' });
    assert.equal(sent.model, 'm');
    assert.equal(sent.language, 'es');

    await V.transcribeAudio(clip, {
        slot: { provider: 'openai', baseUrl: 'https://api.openai.test/v1', apiKey: 'k'.repeat(12), model: 'whisper-1' },
        fetchImpl: capture()
    });
    const oa = seen.pop();
    assert.notEqual(oa.init.headers['Content-Type'], 'application/json',
        'multipart must NOT set Content-Type itself: the browser adds the boundary');
    assert.ok(oa.init.body instanceof globalThis.FormData, 'the body is FormData');
    assert.deepEqual(oa.init.body.parts.map(p => p[0]), ['file', 'model']);

    // An error must never carry the key.
    const withKey = 'sk-or-v1-SUPERSECRET1234';
    const boom = await V.transcribeAudio(clip, {
        slot: { provider: 'openrouter', baseUrl: 'https://x.test/v1', apiKey: withKey, model: 'm' },
        fetchImpl: async () => ({ ok: false, status: 401, text: async () => `rejected Bearer ${withKey}` })
    }).then(() => null, e => e);
    assert.ok(boom && /401/.test(boom.message), boom && boom.message);
    assert.ok(!boom.message.includes('SUPERSECRET'), boom.message);
});

test('the wake phrase matches only at the start, folded and de-punctuated', async () => {
    const V = await import('../js/aiVoice.js');

    // The three things a recogniser hands back that a naive startsWith misses.
    assert.deepEqual(V.matchWakePhrase('Hey Nova push b fuerte'),
        { phrase: 'hey nova', rest: 'push b fuerte', alone: false });
    assert.deepEqual(V.matchWakePhrase('¡Hey, Nova! - saque corto a la derecha'),
        { phrase: 'hey nova', rest: 'saque corto a la derecha', alone: false });
    assert.deepEqual(V.matchWakePhrase('okay hey nova push b'),
        { phrase: 'hey nova', rest: 'push b', alone: false });

    // The wake word ALONE means "I am here", not "do something".
    assert.deepEqual(V.matchWakePhrase('hey nova'),
        { phrase: 'hey nova', rest: '', alone: true });

    // A specific phrase beats the bare one when both match.
    assert.equal(V.matchWakePhrase('nova drive f').phrase, 'nova');

    // Accented Spanish survives being handed back to the parser.
    assert.equal(V.matchWakePhrase('hey nova, saque al revés').rest, 'saque al revés');
});

test('a wake word mid-sentence does not fire', async () => {
    const V = await import('../js/aiVoice.js');
    // A wake word that fires anywhere is worse than no wake word at all: it
    // would answer to "dame un nova al medio".
    for (const said of ['empujame un drive', 'dame un nova al medio', 'necesito un push', '']) {
        assert.equal(V.matchWakePhrase(said), null, JSON.stringify(said));
    }
});

test('the wake phrase list is the user\'s, and junk in it is dropped', async () => {
    const V = await import('../js/aiVoice.js');
    assert.equal(V.matchWakePhrase('hola nova', ['hola nova'])?.phrase, 'hola nova');
    assert.equal(V.matchWakePhrase('hey nova', ['hola nova']), null, 'their list replaces ours');
    // An empty list must not mean "never wake up".
    assert.ok(V.matchWakePhrase('hey nova', []), 'falls back to the shipped phrases');
});

test('the screen lock is requested, released, and re-acquired after the browser takes it', async () => {
    const V = await import('../js/aiVoice.js');
    V.releaseScreenLock();

    let asked = 0;
    const listeners = {};
    const handle = {
        addEventListener: (ev, fn) => { listeners[ev] = fn; },
        release: () => { listeners.release?.(); }
    };
    const request = async () => { asked++; return handle; };

    // 1. unsupported: asking is a no-op, not a crash.
    assert.equal(await V.acquireScreenLock({ request: null }), false);
    assert.equal(V.isScreenLockHeld(), false);

    // 2. granted.
    assert.equal(await V.acquireScreenLock({ request }), true);
    assert.equal(V.isScreenLockHeld(), true);
    // Asking twice does not double-request - a second request throws.
    assert.equal(await V.acquireScreenLock({ request }), true);
    assert.equal(asked, 1, 'already held, so not asked again');

    // 3. the browser takes it away on its own schedule; `release` is the only
    //    notification we get, and it is how we learn to re-acquire.
    listeners.release();
    assert.equal(V.isScreenLockHeld(), false);
    assert.equal(await V.acquireScreenLock({ request }), true);
    assert.equal(asked, 2, 're-acquired after the browser let go');

    // 4. denied: no lock, and still no crash.
    V.releaseScreenLock();
    const denied = await V.acquireScreenLock({ request: async () => { throw new Error('denied'); } });
    assert.equal(denied, false);
    assert.equal(V.isScreenLockHeld(), false);

    V.releaseScreenLock();
});

test('wake phrases and the screen lock survive a junk configuration', async () => {
    const store2 = new Map();
    globalThis.localStorage = {
        getItem: (k) => (store2.has(k) ? store2.get(k) : null),
        setItem: (k, v) => store2.set(k, String(v)),
        removeItem: (k) => store2.delete(k),
        clear: () => store2.clear()
    };
    const { getAiConfig, setAiConfig, normalizeConfig } = await import('../js/aiConfig.js');

    assert.equal(normalizeConfig(null).wake.enabled, false, 'arming is never on by default');
    assert.equal(normalizeConfig(null).screenLock, true);
    assert.deepEqual(normalizeConfig({ wake: { phrases: 'hey nova, , BAD!!, ok nova' } }).wake.phrases,
        ['hey nova', 'ok nova'], 'blank and punctuated entries are dropped');
    assert.deepEqual(normalizeConfig({ wake: { phrases: [] } }).wake.phrases,
        ['hey nova', 'ok nova', 'nova'], 'an empty list falls back rather than never waking');

    setAiConfig({ wake: { enabled: true, phrases: ['hola nova'] }, screenLock: false });
    assert.deepEqual(getAiConfig().wake.phrases, ['hola nova']);
    assert.equal(getAiConfig().screenLock, false);
});

test('a destructive tool with no confirmation hook declines', async () => {
    // The safe default: no way to ask means do nothing, not "assume yes".
    store.clear();
    P_reset();
    const handlers = A.makeToolHandlers({ ask: null });
    const made = await handlers.create_preset({ name: 'Mine', intent: { role: 'push', side: 'bh' } });
    assert.ok(made.id, 'creating a preset needs no confirmation');

    const removed = await handlers.delete_preset({ id: made.id });
    assert.match(removed.error, /declined/);
    assert.ok(A_getPresets().some(p => p.id === made.id), 'the preset is still there');
});

test('a confirmation hook can say yes', async () => {
    store.clear();
    P_reset();
    const asked = [];
    const handlers = A.makeToolHandlers({
        ask: async ({ question }) => { asked.push(question); return 'yes'; }
    });
    const made = await handlers.create_preset({ name: 'Mine', intent: { role: 'loop', side: 'fh' } });
    const removed = await handlers.delete_preset({ id: made.id });
    assert.equal(removed.deleted, 'Mine');
    assert.match(asked[0], /Delete the preset/);
    assert.ok(!A_getPresets().some(p => p.id === made.id));
});

// Small indirections so the two tests above read cleanly.
const P = await import('../js/presets.js');
function P_reset() { P.resetPresetsToDefaults(); }
function A_getPresets() { return P.getPresets(); }
