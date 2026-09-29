/**
 * The first live call, against a real OpenRouter endpoint.
 *
 * Development only; not part of the build and not shipped (see AGENTS.md,
 * "What does not [ship]"). It exists because a fake endpoint proves the code
 * paths but not the provider: the real auth header, the real model id, real
 * SSE framing, and real tool calling.
 *
 * The key is read from the environment and NEVER written anywhere: not to
 * disk, not to localStorage, not to a log line. Usage is printed at the end so
 * the spend can be checked against OpenRouter's own dashboard.
 *
 *   OPENROUTER_KEY=sk-or-... node tools/live-check.mjs [baseUrl] [model]
 *
 * What it does, in order, cheapest first:
 *   1. a 8-token ping        - proves the key, the base URL and the model id
 *   2. one real Tier 1 turn  - an unparseable sentence, the tool loop, and the
 *                              draft that comes out the far end
 *   3. redaction             - an upstream that echoes the key back must not
 *                              put it in the message we print
 */

const KEY = process.env.OPENROUTER_KEY || '';
const BASE = process.argv[2] || 'https://openrouter.ai/api/v1';
const MODEL = process.argv[3] || 'deepseek/deepseek-v4.1-flash';

if (!KEY) {
    console.error('OPENROUTER_KEY is not set. Nothing was sent.');
    process.exit(2);
}

// Bare-Node shims, so the real modules load unchanged. They are here to satisfy
// the browser APIs the app modules touch at import time - nothing in this test
// path calls any of them.
const store = new Map();
globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
    clear: () => store.clear()
};
globalThis.document = { addEventListener() {}, dispatchEvent() {} };
globalThis.window = {};

const { chat, runAgent, systemPrompt, MAX_ROUNDS } = await import('../v2/js/aiClient.js');
const { TOOLS, makeToolHandlers } = await import('../v2/js/aiAgent.js');
const { parseUtterance } = await import('../v2/js/aiTerms.js');

const SLOT = { provider: 'openrouter', baseUrl: BASE, apiKey: KEY, model: MODEL };

let failed = false;
const check = (name, pass, extra = '') => {
    if (!pass) failed = true;
    console.log(`  ${pass ? 'ok  ' : 'FAIL'}  ${name}${extra ? '   ' + extra : ''}`);
};

// Every call goes through the real module, so `fetch` is injected rather than
// stubbed: this is the app's own code path, not a reimplementation of it.
const realFetch = (url, init) => fetch(url, init);

console.log(`endpoint  ${BASE}/chat/completions`);
console.log(`model     ${MODEL}\n`);

console.log('1. the smallest possible completion');
try {
    const ping = await chat({
        messages: [{ role: 'user', content: 'Reply with the single word: ok' }],
        // 64, not 8: a reasoning model spends the budget on thinking, and a
        // budget of 8 leaves nothing for the answer - which is how this test
        // first "failed" against a model that was working perfectly.
        maxTokens: 64,
        temperature: 0,
        stream: true,
        slot: SLOT,
        fetchImpl: realFetch
    });
    check('the endpoint answered', !!ping.text, JSON.stringify(ping.text));
    check('streaming delivered the text incrementally', !!ping.text.trim());
    console.log(`     usage: ${JSON.stringify(ping.usage)}`);
} catch (err) {
    console.log(`  FAIL  ${err.name || 'Error'} [${err.code}] ${err.message}`);
    // A redacted 401 is the most likely first outcome, and the one worth
    // showing: the key must be gone from the message.
    check('the key is not in the error message', !err.message.includes(KEY.slice(6, 20)));
    process.exit(1);
}

console.log('\n2. the same sentence through both tiers');
const SENTENCE = 'Armame un ejercicio: un push suave al reves y despues un drive fuerte a la derecha.';

// Tier 0 first - it must either answer or say it could not, without a request.
const local = parseUtterance(SENTENCE);
console.log(`     Tier 0: ${local ? `${local.intents.length} intent(s), unresolved=${local.unresolved}` : 'null (falls through)'}`);

console.log('\n3. the real agent loop, with tool calling');
try {
    const res = await runAgent({
        messages: [{ role: 'user', content: SENTENCE }],
        tools: TOOLS,
          language: 'es',
        slot: SLOT,
        fetchImpl: realFetch,
        maxRounds: 3,
        totalTimeoutMs: 60000,
        onTool: (name, args) => console.log(`     tool: ${name} ${JSON.stringify(args).slice(0, 110)}`)
    });

    check('the model produced prose', !!res.text, JSON.stringify((res.text || '').slice(0, 120)));
    check('it stopped on its own, not on the cap', res.stopped === 'done', `stopped=${res.stopped}`);
    check(`it stayed inside ${MAX_ROUNDS} rounds`, res.rounds <= MAX_ROUNDS, `rounds=${res.rounds}`);
    console.log(`     usage: ${JSON.stringify(res.usage)}`);

    // The point of the whole design: what came out the far end is a real ball
    // array, compiled by makeBall(), not anything the model typed.
    const { getDraft } = await import('../v2/js/aiStore.js');
    const { normalizeBall } = await import('../v2/js/ball.js');
    const draft = getDraft();
    check('a draft exists', !!draft);
    if (draft) {
        const flat = draft.steps.flat();
        check('its steps are real ball arrays', flat.length > 0 && flat.every(b => Array.isArray(b) && b.length >= 7),
            `${flat.length} ball(s)`);
        check('every ball survives normalizeBall unchanged',
            flat.every(b => normalizeBall(b.slice()).join('|') === b.join('|')));
        check('every ball is explicitly active', flat.every(b => b[6] === 1));
        for (const b of flat) console.log(`     ball: ${b.join(' ')}`);
    }
} catch (err) {
    check('the agent loop completed', false, `${err.name || 'Error'} [${err.code}] ${err.message}`);
    check('the key is not in the error message', !err.message.includes(KEY.slice(6, 20)));
}

console.log(failed ? '\nLIVE CHECK FAILED' : '\nLIVE CHECK OK');
process.exit(failed ? 1 : 0);
