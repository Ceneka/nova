/**
 * The account + backup client, driven without a browser.
 *
 * What is worth testing here is not the plumbing but the invariants, because
 * three of them are the reason this feature is allowed to exist at all:
 *
 *   - **the AI API key never travels.** `collectBundle()` walks a fixed key
 *     list precisely so that "upload everything in localStorage" can never
 *     happen by accident. If somebody ever widens it, this file fails.
 *   - **a restore cannot write a key the app does not know about.** A server
 *     response is as untrusted as a hand-edited entry.
 *   - **a sign-in callback this browser did not start is refused**, and a
 *     replayed one cannot be reused.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

// --- a localStorage / sessionStorage stub, before anything touches them ------

const makeStore = () => {
    const map = new Map();
    return {
        getItem: (k) => (map.has(k) ? map.get(k) : null),
        setItem: (k, v) => map.set(k, String(v)),
        removeItem: (k) => map.delete(k),
        clear: () => map.clear(),
        _map: map
    };
};

const local = makeStore();
const session = makeStore();
globalThis.localStorage = local;
globalThis.sessionStorage = session;

const { collectBundle, applyBundle, SYNC_KEYS, LOCAL_ONLY_KEYS } = await import('../v2/js/sync.js');
const account = await import('../v2/js/account.js');

const reset = () => {
    local.clear();
    session.clear();
};

// --- what travels -----------------------------------------------------------

test('the AI API key is never part of a backup', () => {
    reset();
    local.setItem('nova_ai_config', JSON.stringify({ text: { apiKey: 'sk-or-v1-secret' } }));
    local.setItem('custom_drills', JSON.stringify({ 'push(b)': [[]] }));

    const bundle = collectBundle();

    assert.equal(bundle.nova_ai_config, undefined, 'the key must not be in the bundle');
    assert.ok(!JSON.stringify(bundle).includes('sk-or-v1-secret'));
    assert.ok(Object.prototype.hasOwnProperty.call(bundle, 'custom_drills'));
});

test('the stored credentials and the dev API override never travel either', () => {
    reset();
    local.setItem('nova_account', JSON.stringify({ refresh: 'a-refresh-token' }));
    local.setItem('nova_api_base', 'http://localhost:3000');
    local.setItem('nova_sessions', '[]');

    const bundle = collectBundle();

    for (const key of LOCAL_ONLY_KEYS) {
        assert.equal(bundle[key], undefined, `${key} must not be in the bundle`);
    }
    assert.ok(!JSON.stringify(bundle).includes('a-refresh-token'));
});

test('a key that will not parse is kept as its raw string, not dropped', () => {
    reset();
    local.setItem('nova_theme_pref', 'night');
    local.setItem('drill_order', 'not json at all');

    const bundle = collectBundle();

    assert.equal(bundle.nova_theme_pref, 'night');
    assert.equal(bundle.drill_order, 'not json at all');
});

test('only keys on the list are collected, whatever else is in storage', () => {
    reset();
    local.setItem('custom_data', '{}');
    local.setItem('something_we_never_heard_of', '"surprise"');

    const bundle = collectBundle();

    assert.deepEqual(Object.keys(bundle), ['custom_data']);
    for (const key of Object.keys(bundle)) assert.ok(SYNC_KEYS.includes(key));
});

// --- what a restore may write -----------------------------------------------

test('a bundle round-trips this app’s own storage byte for byte', () => {
    // The pairing to protect: `collectBundle` JSON-parses a stored value and
    // falls back to the raw string when that fails, and `applyBundle` writes a
    // string back raw and everything else re-stringified. For the way this app
    // actually stores things - `nova_theme_pref` is `forest`, not `"forest"` -
    // that composition is the identity.
    reset();
    local.setItem('custom_data', '{"a":[[1]]}');
    local.setItem('nova_theme_pref', 'forest');
    local.setItem('nova_lang', 'es');
    local.setItem('nova_stats', '{"balls":10,"drills":2}');

    const bundle = collectBundle();
    local.clear();
    applyBundle(bundle);

    assert.equal(local.getItem('custom_data'), '{"a":[[1]]}');
    assert.equal(local.getItem('nova_theme_pref'), 'forest');
    assert.equal(local.getItem('nova_lang'), 'es');
    assert.equal(local.getItem('nova_stats'), '{"balls":10,"drills":2}');
});

test('a restore writes exactly the keys the bundle carries', () => {
    reset();
    const result = applyBundle({ custom_data: { a: [] }, nova_theme_pref: 'forest' });
    assert.equal(result.applied, 2);
    assert.deepEqual(JSON.parse(local.getItem('custom_data')), { a: [] });
    assert.equal(local.getItem('nova_theme_pref'), 'forest');
});

test('a restore cannot write a key the app does not know about', () => {
    reset();
    // A bundle is a server response: as untrusted as a hand-edited entry.
    const result = applyBundle({ nova_ai_config: { text: { apiKey: 'injected' } } });

    assert.equal(result.applied, 0);
    assert.equal(local.getItem('nova_ai_config'), null);
});

test('a restore does not delete a key the backup did not carry', () => {
    // An older backup restoring onto a newer app must not reset whatever the
    // newer version added.
    reset();
    local.setItem('nova_ai_drills', '{"kept":true}');
    applyBundle({ custom_data: {} });
    assert.equal(local.getItem('nova_ai_drills'), '{"kept":true}');
});

test('a restore of junk changes nothing', () => {
    reset();
    for (const junk of [null, undefined, 'text', 42, [1, 2]]) {
        assert.deepEqual(applyBundle(junk), { applied: 0, ignored: 0 });
    }
});

// --- stored session shape ----------------------------------------------------

test('a hand-edited account entry is normalized, never trusted', () => {
    assert.deepEqual(account.normalizeAccount(null), {
        access: '', expiresAt: 0, refresh: '', user: null, savedAt: null
    });
    assert.deepEqual(account.normalizeAccount('nonsense').access, '');

    const weird = account.normalizeAccount({
        access: 'a'.repeat(9999),
        expiresAt: 'soon',
        refresh: { not: 'a string' },
        user: 'not an object'
    });
    assert.ok(weird.access.length <= 4000);
    assert.equal(weird.expiresAt, 0);
    assert.equal(weird.refresh, '');
    assert.equal(weird.user, null);
});

// --- the API base ------------------------------------------------------------

test('the API base defaults to the site and accepts a dev override', () => {
    reset();
    assert.equal(account.getApiBase(), 'https://tenisdemesa.ar');
    assert.equal(account.apiUrl('/api/nova/sync'), 'https://tenisdemesa.ar/api/nova/sync');

    local.setItem('nova_api_base', 'http://localhost:3000/');
    assert.equal(account.getApiBase(), 'http://localhost:3000');
    // A value that is not an http(s) URL is ignored rather than obeyed.
    local.setItem('nova_api_base', 'javascript:alert(1)');
    assert.equal(account.getApiBase(), 'https://tenisdemesa.ar');
});

// --- PKCE --------------------------------------------------------------------

test('the challenge is the base64url SHA-256 of its own verifier', async () => {
    const verifier = account.randomToken(32);
    const challenge = await account.codeChallenge(verifier);

    assert.match(challenge, /^[A-Za-z0-9_-]{43}$/);
    assert.notEqual(challenge, await account.codeChallenge(account.randomToken(32)));
});

test('verifiers are url-safe and not repeated', () => {
    const seen = new Set(Array.from({ length: 50 }, () => account.randomToken(32)));
    assert.equal(seen.size, 50);
    for (const token of seen) assert.match(token, /^[A-Za-z0-9_-]+$/);
});

// --- the sign-in handshake --------------------------------------------------

test('a callback with no pending sign-in is refused', async () => {
    reset();
    const result = await account.completeSignIn({ code: 'abc', state: 'xyz' });
    assert.equal(result.ok, false);
    assert.equal(result.error, 'no_pending_signin');
});

test('a callback whose state does not match is refused', async () => {
    reset();
    session.setItem('nova_account_pending', JSON.stringify({
        verifier: 'v', state: 'the-real-one', returnTo: './'
    }));
    const result = await account.completeSignIn({ code: 'abc', state: 'a-forged-one' });
    assert.equal(result.ok, false);
    assert.equal(result.error, 'state_mismatch');
});

test('a callback with NO state is refused, not waved through', async () => {
    // The lenient form of this check - "only compare when both are present" -
    // reads like a convenience and is a bypass: omitting the parameter skipped
    // the comparison altogether, and the parameter is attacker-controlled.
    reset();
    session.setItem('nova_account_pending', JSON.stringify({
        verifier: 'v', state: 'the-real-one', returnTo: './'
    }));
    const result = await account.completeSignIn({ code: 'abc' });
    assert.equal(result.ok, false);
    assert.equal(result.error, 'state_mismatch');
});

test('the pending entry is consumed even when the state is wrong', async () => {
    // Otherwise a mismatched callback could be replayed until one landed.
    reset();
    session.setItem('nova_account_pending', JSON.stringify({
        verifier: 'v', state: 'the-real-one', returnTo: './'
    }));
    await account.completeSignIn({ code: 'abc', state: 'a-forged-one' });
    assert.equal(session.getItem('nova_account_pending'), null);
});

test('a callback with no code is refused before anything else happens', async () => {
    reset();
    assert.deepEqual(
        await account.completeSignIn({ code: '', state: 'x' }),
        { ok: false, error: 'missing_code' }
    );
});

// --- authenticated requests -------------------------------------------------

test('apiFetch refuses rather than sending an unauthenticated request', async () => {
    reset();
    const result = await account.apiFetch('/api/nova/sync');
    assert.equal(result.ok, false);
    assert.equal(result.status, 401);
    assert.equal(result.data, null);
});

// --- share codes -------------------------------------------------------------

const { isValidCode } = await import('../v2/js/cloud.js');

test('share codes keep the shape the app always used', () => {
    assert.equal(isValidCode('ABC123'), true);
    assert.equal(isValidCode('  abc123 '), true);
    for (const bad of ['ABC12', 'ABC1234', '123456', 'AB1D23', '', null]) {
        assert.equal(isValidCode(bad), false);
    }
});
