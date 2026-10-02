/**
 * The model tier's transport: an OpenAI-compatible client and a bounded agent
 * loop.
 *
 * ## It is injected, and that is the whole design
 *
 * `fetch` is a PARAMETER, never the global. That is what makes the model tier
 * testable in bare Node with no network - `tests/ai.test.mjs` drives a fake
 * endpoint, including a chunked SSE response that splits one tool call across
 * two events, a model that never stops calling tools, a 401, a malformed
 * `tool_calls`, and an aborted request. It also means the app can pass a
 * wrapped fetch in tests without stubbing a global.
 *
 * ## Hard caps, because an agent loop is an unbounded loop without them
 *
 * **8 tool rounds** and **150 seconds total**, both abortable. A model that
 * calls a tool forever is a model that holds a spinner forever; a cap turns
 * that into an error the assistant can say out loud. `MAX_ROUNDS` is the
 * reason the "never stops calling tools" test passes instead of hanging.
 *
 * **The two caps have to be the right way round, and they were not.** The
 * per-request watchdog was 30s inside a 45s total, so the FIRST request of a
 * reasoning model could consume two thirds of the entire budget before the
 * agent had made one tool call - and the thing the user saw was "The request
 * was cancelled or timed out" on a model that was working correctly and had
 * three seconds of agent budget left anyway. Reported against a live endpoint
 * running `deepseek/deepseek-v4.1-flash` with a 2048-token THINKING budget:
 * thinking alone ran past 30 seconds. `MAX_ROUNDS` is now the binding cap,
 * because it is the one that means something about the agent rather than about
 * one HTTP round trip.
 *
 * ## Streaming is the default, not a nicety
 *
 * A voice assistant that waits for the whole answer before it says anything
 * feels broken, and the user has to be able to tell *thinking* from *broken*.
 * So the SSE parser below is hand-rolled - about thirty lines, because there is
 * no build step and no SDK in this project - and the assistant's prose streams
 * into the transcript and the speech queue as it arrives, while the tool trace
 * updates between rounds. `stream: false` is one flag for endpoints that do
 * not do SSE.
 *
 * ## What the model is allowed to do
 *
 * It is given TOOLS, not a ball array. There is no tool in `TOOLS` below that
 * writes a raw ball and none that writes `currentDrills`; `persist_draft` is
 * the single funnel into storage and it is the user's decision, not the
 * model's. What the model produces is *intent*, which `aiCompile.js` turns
 * into an array through `makeBall()`.
 *
 * ## The key
 *
 * It is sent only as an `Authorization` header to the one base URL the user
 * typed. Every error path runs its text through `redact()` first, because a
 * provider that echoes the Authorization header into its own error body is a
 * real thing, and that text ends up in the DOM and in a screenshot.
 *
 * ## Node-safe
 *
 * No DOM, no globals beyond the injected `fetch` and `Date`.
 */

import {
    getAiConfig, isTextConfigured, chatUrl, buildHeaders, redact
} from './aiConfig.js';
import { vocabularyForPrompt, ROLES, ROTATIONS, SIDES, DEPTHS } from './aiTerms.js';

/** The plan's caps. Changing these changes what a runaway model costs. */
export const MAX_ROUNDS = 8;
export const TOTAL_TIMEOUT_MS = 150000;
export const PER_REQUEST_TIMEOUT_MS = 90000;

/**
 * Tokens per turn.
 *
 * Not a "reply length" budget. Since ~2025 a large share of the models behind
 * an OpenAI-compatible endpoint are **reasoning** models, and they emit
 * `reasoning` deltas alongside `content` deltas that are present but EMPTY.
 * A budget that was generous for an answer is consumed entirely by thinking:
 * the first live turn against `deepseek/deepseek-v4.1-flash` reported
 * `completion_tokens: 700, reasoning_tokens: 700, finish_reason: "length"` and
 * returned no content and no tool call at all - so the user got a silent empty
 * reply that looked like the model had simply finished. Hence a budget sized
 * for thinking plus the answer, and a hard check for being cut off.
 */
export const DEFAULT_MAX_TOKENS = 2048;

// --- errors -----------------------------------------------------------------

/**
 * Every failure the UI can show, as a stable `code` plus a message that is
 * already redacted. The panel switches on `code`; nothing here is translated
 * here, because this module has no access to the language and must not guess.
 */
export class AiError extends Error {
    constructor(code, message, { status = 0, cause = null } = {}) {
        super(message);
        this.name = 'AiError';
        this.code = code;
        this.status = status;
        this.cause = cause;
    }
}

/**
 * `scrub` is the key this particular request was sent with, which is not always
 * the stored one: `chat()` takes a slot by argument so a test - or a future
 * second provider - can pass a key the configuration does not hold. Redacting
 * only the stored key would leave THAT key sitting in an error message, which
 * is the exact leak this function exists to prevent.
 */
const fail = (code, message, extra, scrub = null) => {
    throw new AiError(code, redact(message, scrub ? [scrub] : []), extra);
};

// --- the system prompt ------------------------------------------------------

/**
 * Short and blunt, and built from the vocabulary table rather than restating
 * it, so the deterministic tier and the model tier cannot drift apart: the
 * list of words the model is allowed to use IS the list `parseUtterance()`
 * matches on.
 */
export function systemPrompt({ language = 'en', tools = [] } = {}) {
    return `You are a table-tennis coach for the Nova S Pro robot.

You never produce numbers. You produce INTENT objects from this fixed vocabulary, and the app compiles them into the robot's ball array. Anything numeric you invent is discarded.

Vocabulary:
${vocabularyForPrompt()}

Rules:
- role is one of: ${ROLES.join(', ')}.
- rotation is one of: ${ROTATIONS.join(', ')}. It decides the ball's type: back and side spin are backspin balls, top and flat are topspin balls.
- side is one of: ${SIDES.join(', ')}. It is named from the RECEIVER's point of view for a right-handed receiver, so "backhand" is a NEGATIVE drop and "forehand" is POSITIVE.
- depth is one of: ${DEPTHS.join(', ')}. Short/long is a proxy for how deep the ball lands, not a height.
- intensity is 0..10, where 5 is neutral. "Strong" raises the speed, "soft" lowers it. It never adds scatter.
- "saque" and "push" are the same word here. A depth word means it is a serve; no depth word means it is a rally push.
- Reuse the user's own presets when search_presets returns a good match, and say which one you used.
- If nothing matches, say plainly that you did not find one and generated it. Never invent a preset name.
- persist_draft is the user's decision, not yours. Propose, then stop.
- Reply in ${language === 'es' ? 'Spanish' : 'English'}. Keep prose to one or two spoken sentences.
${tools.length ? `\nTools available: ${tools.map(t => t.function?.name || t.name).filter(Boolean).join(', ')}.` : ''}`;
}

// --- SSE --------------------------------------------------------------------

/**
 * Read a streamed response, yielding the parsed chunks.
 *
 * `data:` lines are JSON; a `data: [DONE]` sentinel ends it. The parser is
 * deliberately tolerant of a chunk boundary falling anywhere - including in
 * the MIDDLE of a tool call's JSON arguments - because that is exactly where a
 * naive `split('\n')` loses the call and the assistant silently does nothing.
 * The buffer carries the partial line over to the next read.
 */
export async function* readSse(response) {
    if (!response.body) return;

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    try {
        for (;;) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });

            // Events are separated by a blank line; a single newline inside a
            // data block is part of the payload, not a separator.
            let split;
            while ((split = buffer.indexOf('\n\n')) !== -1) {
                const block = buffer.slice(0, split);
                buffer = buffer.slice(split + 2);
                for (const line of block.split('\n')) {
                    if (!line.startsWith('data:')) continue;
                    const payload = line.slice(5).trim();
                    if (!payload || payload === '[DONE]') continue;
                    try {
                        yield JSON.parse(payload);
                    } catch {
                        // A malformed event is dropped, not thrown: one bad
                        // chunk in a long stream should not lose the reply.
                    }
                }
            }
        }
    } finally {
        try { reader.cancel(); } catch { /* already closed */ }
    }
}

/** Fold the streamed deltas into the shape a non-streamed response would have. */
function accumulate(state, chunk) {
    if (!chunk || typeof chunk !== 'object') return;
    const choice = chunk.choices?.[0];
    const delta = choice?.delta || {};

    if (typeof delta.content === 'string' && delta.content) {
        state.text += delta.content;
    }
    if (typeof delta.reasoning === 'string' && delta.reasoning) {
        state.reasoning += delta.reasoning;
    }
    if (delta.tool_calls?.length) {
        for (const call of delta.tool_calls) {
            const i = call.index ?? 0;
            const slot = state.toolCalls[i] || (state.toolCalls[i] = { id: '', name: '', args: '' });
            if (call.id) slot.id += call.id;
            if (call.function?.name) slot.name += call.function.name;
            if (call.function?.arguments) slot.args += call.function.arguments;
        }
    }
    if (choice?.finish_reason) state.finishReason = choice.finish_reason;
    if (chunk.usage) state.usage = chunk.usage;
}

/** Parse a tool call's argument string. A model that sent junk gets `{}`. */
function parseArgs(args) {
    if (!args) return {};
    try {
        const parsed = JSON.parse(args);
        return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
        return {};
    }
}

/** The tool calls of a completed response, in the shape the loop consumes. */
export function toolCallsFrom(state) {
    return state.toolCalls
        .filter(c => c && c.name)
        .map((c, i) => ({
            id: c.id || `call_${i}`,
            type: 'function',
            function: { name: c.name, arguments: c.args || '{}' }
        }));
}

// --- one request ------------------------------------------------------------

/**
 * A single chat completion. `fetchImpl` is injected; nothing here touches the
 * global `fetch`.
 *
 * @returns {Promise<{text: string, toolCalls: Array, usage: object|null, raw: object}>}
 */
export async function chat({
    messages,
    tools = null,
    temperature = 0.4,
    maxTokens = DEFAULT_MAX_TOKENS,
    stream = true,
    slot = null,
    fetchImpl = null,
    signal = null,
    onText = null
} = {}) {
    const config = slot || getAiConfig().text;
    const doFetch = fetchImpl || (typeof fetch === 'function' ? fetch : null);
    if (!doFetch) fail('no-fetch', 'This browser has no fetch.');
    if (!isTextConfigured() && !slot) fail('not-configured', 'No API key configured.');
    if (!config?.apiKey) fail('not-configured', 'No API key configured.');

    const url = chatUrl(config);
    if (!url) fail('not-configured', 'No base URL configured.');
    const scrub = config.apiKey;

    const body = {
        model: config.model,
        messages,
        temperature,
        max_tokens: maxTokens,
        stream: !!stream
    };
    if (tools?.length) {
        body.tools = tools;
        body.tool_choice = 'auto';
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), PER_REQUEST_TIMEOUT_MS);
    // The caller's signal and ours are merged: a cancel button has to work
    // while the watchdog is also counting down.
    const onAbort = () => controller.abort();
    if (signal) {
        if (signal.aborted) controller.abort();
        else signal.addEventListener('abort', onAbort, { once: true });
    }

    let res;
    try {
        res = await doFetch(url, {
            method: 'POST',
            headers: buildHeaders(config),
            body: JSON.stringify(body),
            signal: controller.signal
        });
    } catch (err) {
        if (controller.signal.aborted) fail('timeout', 'The request was cancelled or timed out.', { cause: err }, scrub);
        fail('network', `Could not reach the endpoint: ${err?.message || err}`, { cause: err }, scrub);
    } finally {
        clearTimeout(timer);
        if (signal) signal.removeEventListener('abort', onAbort);
    }

    if (!res.ok) {
        // The body can contain the caller's own Authorization header, because
        // some proxies echo it. Redact before it becomes a message.
        let detail = '';
        try { detail = (await res.text()).slice(0, 400); } catch { /* unreadable body */ }
        const code = res.status === 401 || res.status === 403 ? 'unauthorized'
            : res.status === 429 ? 'rate-limited' : 'http';
        fail(code, `HTTP ${res.status}${detail ? `: ${redact(detail, [scrub])}` : ''}`, { status: res.status }, scrub);
    }

    const state = { text: '', reasoning: '', toolCalls: [], usage: null, finishReason: null };

    if (stream) {
        for await (const chunk of readSse(res)) {
            accumulate(state, chunk);
            // Streamed prose goes to the transcript and the speech queue as it
            // arrives, which is the difference between "thinking" and "hung".
            if (onText && state.text) onText(state.text);
        }
    } else {
        let data;
        try {
            data = await res.json();
        } catch (err) {
            fail('bad-response', `The endpoint did not return JSON: ${err?.message || err}`, null, scrub);
        }
        accumulate(state, {
            choices: [{ delta: { content: data?.choices?.[0]?.message?.content }, finish_reason: data?.choices?.[0]?.finish_reason }],
            usage: data?.usage
        });
        for (const call of (data?.choices?.[0]?.message?.tool_calls || [])) {
            if (!call?.function?.name) continue;
            state.toolCalls[call.index ?? state.toolCalls.length] = {
                id: call.id || '',
                name: call.function.name,
                args: call.function.arguments || '{}'
            };
        }
    }

    return {
        text: state.text,
        toolCalls: toolCallsFrom(state),
        usage: state.usage,
        finishReason: state.finishReason
    };
}

// --- the agent loop ---------------------------------------------------------

/**
 * Run the conversation until the model stops asking for tools, the caps fire,
 * or the user cancels.
 *
 * `handleTool(name, args)` returns whatever to send back as the tool result -
 * a string, or any JSON-serialisable value. A handler that throws is reported
 * back to the model as a failed tool result rather than killing the loop: a
 * tool that cannot find a preset is a normal outcome the model should be told
 * about, not an error it should guess its way past.
 *
 * @returns {Promise<{text: string, rounds: number, usage: object|null, stopped: string}>}
 */
export async function runAgent({
    messages,
    tools,
    handleTool,
    system = null,
    language = 'en',
    temperature = 0.4,
    maxTokens = DEFAULT_MAX_TOKENS,
    stream = true,
    slot = null,
    fetchImpl = null,
    signal = null,
    onText = null,
    onTool = null,
    maxRounds = MAX_ROUNDS,
    totalTimeoutMs = TOTAL_TIMEOUT_MS,
    setTimer = (fn, ms) => setTimeout(fn, ms),
    clearTimer = (id) => clearTimeout(id)
} = {}) {
    const history = system
        ? [{ role: 'system', content: systemPrompt({ language, tools }) }, ...messages]
        : [...messages];

    const started = Date.now();

    // A local controller so the total-timeout can cancel an in-flight request
    // without the caller having to hold one, merged with whatever the caller
    // passed (a cancel button) so either can stop the turn.
    const local = new AbortController();
    const deadline = setTimer(() => local.abort(), totalTimeoutMs);
    const merged = mergeSignals(signal, local);

    let usage = null;
    let text = '';
    let rounds = 0;
    let stopped = 'done';

    try {
        for (; rounds < maxRounds; rounds++) {
            let res = await chat({
                messages: history,
                tools, temperature, maxTokens, stream, slot, fetchImpl,
                signal: merged,
                onText
            });

            // Cut off mid-thought with nothing to show for it: retry ONCE with
            // double the budget, because the cause is nearly always a reasoning
            // model that needed more room than the default. Failing here is
            // better than the alternative, which is an empty answer bubble that
            // looks exactly like a model that simply had nothing to say.
            if (res.finishReason === 'length' && !res.text && !res.toolCalls.length) {
                res = await chat({
                    messages: history,
                    tools, temperature, maxTokens: maxTokens * 2, stream, slot, fetchImpl,
                    signal: merged,
                    onText
                });
            }
            if (res.finishReason === 'length' && !res.text && !res.toolCalls.length) {
                fail('truncated',
                    'The model spent its whole budget thinking and never got to an answer.');
            }

            if (res.usage) usage = res.usage;
            if (res.text) text = res.text;
            if (!res.toolCalls.length) break;

            history.push({
                role: 'assistant',
                content: res.text || null,
                tool_calls: res.toolCalls
            });

            for (const call of res.toolCalls) {
                const name = call.function.name;
                const args = parseArgs(call.function.arguments);

                // A tool the model invented is reported, not executed. Without
                // this a hallucinated tool name is an undefined function call.
                if (!tools?.some(t => (t.function?.name || t.name) === name)) {
                    history.push({ role: 'tool', tool_call_id: call.id, content: `No such tool: ${redact(name, [slot?.apiKey])}` });
                    continue;
                }

                if (onTool) onTool(name, args);

                let result;
                try {
                    result = await handleTool(name, args);
                } catch (err) {
                    result = { error: redact(err?.message || String(err)) };
                }
                history.push({
                    role: 'tool',
                    tool_call_id: call.id,
                    content: typeof result === 'string' ? result : JSON.stringify(result ?? null)
                });
            }

            if (Date.now() - started > totalTimeoutMs) { stopped = 'timeout'; break; }
        }
        if (rounds >= maxRounds) stopped = 'max-rounds';
    } catch (err) {
        if (err instanceof AiError) throw err;
        fail('unknown', err?.message || String(err), { cause: err }, slot?.apiKey);
    } finally {
        clearTimer(deadline);
        // Releasing the local controller stops any listener the merged signal
        // left attached. After a normal return the request is already done, so
        // this aborts nothing.
        local.abort();
    }

    return { text, rounds, usage, stopped, messages: history };
}

// --- abort plumbing ---------------------------------------------------------

function mergeSignals(a, b) {
    if (!a) return b.signal;
    const any = new AbortController();
    const abort = () => any.abort();
    if (a.aborted || b.signal.aborted) any.abort();
    else {
        a.addEventListener('abort', abort, { once: true });
        b.signal.addEventListener('abort', abort, { once: true });
    }
    return any.signal;
}

/** One line of usage, redacted, for the status line after a turn. */
export function usageLine(usage) {
    if (!usage || typeof usage !== 'object') return '';
    const total = Number(usage.total_tokens);
    if (!Number.isFinite(total)) return '';
    return `${total} tokens`;
}
