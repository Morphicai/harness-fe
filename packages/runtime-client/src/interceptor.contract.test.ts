// @vitest-environment happy-dom
/**
 * Phase 0 — interceptor contract spec for @harness-fe/sandbox.
 *
 * Every test below describes a USE CASE the lib must support after refactor:
 * the consumer can ALTER (not just observe) the operation — modify request,
 * block storage write, rewrite navigation URL, drop ws frame, etc.
 *
 * The current `installFetchPatch` / `installXhrPatch` / `installWsPatch` /
 * `installStoragePatch` are OBSERVER-ONLY: their only hook is `onEntry`, which
 * is called AFTER the action, with no return-value semantics.
 *
 * These tests are recorded as `it.todo(...)` — they document the required API.
 * Once `installSandbox` lands, flip `.todo` → real `it()` and implement.
 */

import { describe, it } from 'vitest';

describe('Interceptor contract — Phase 0 spec [all .todo until refactor]', () => {

    // ──────────────────────────────────────────────────────────────
    // fetch
    // ──────────────────────────────────────────────────────────────
    describe('fetch', () => {
        it.todo('onRequest can rewrite the URL before dispatch');
        it.todo('onRequest can inject headers (e.g. x-trace-id)');
        it.todo('onRequest can rewrite request body');
        it.todo('onRequest can return a Response to short-circuit (no network)');
        it.todo('onRequest returning false aborts the request (rejected Promise)');
        it.todo('onResponse can rewrite status / headers / body');
        it.todo('onResponse can short-circuit to a new Response');
        it.todo('observer onEvent still fires AFTER interceptor mutations (sees final values)');
        it.todo('async onRequest is awaited before original fetch is called');
    });

    // ──────────────────────────────────────────────────────────────
    // xhr
    // ──────────────────────────────────────────────────────────────
    describe('xhr', () => {
        it.todo('onRequest can rewrite URL via interceptor');
        it.todo('onRequest can inject headers');
        it.todo('onResponse can rewrite responseText');
        it.todo('onResponse can rewrite status code');
    });

    // ──────────────────────────────────────────────────────────────
    // ws
    // ──────────────────────────────────────────────────────────────
    describe('ws', () => {
        it.todo('onConstruct can substitute the URL before native WebSocket runs');
        it.todo('onConstruct returning false short-circuits to a stub instance');
        it.todo('onSend can drop frame by returning false');
        it.todo('onSend can rewrite outgoing payload');
        it.todo('onMessage can drop incoming frame by returning false');
        it.todo('onMessage can rewrite incoming payload (e.g. decrypt)');
        it.todo('onClose can observe code / reason');
    });

    // ──────────────────────────────────────────────────────────────
    // storage (localStorage / sessionStorage / cookie)
    // ──────────────────────────────────────────────────────────────
    describe('storage', () => {
        it.todo('onSet returning false blocks the write — getItem returns null');
        it.todo('onSet can rewrite key (e.g. namespace prefix)');
        it.todo('onSet can rewrite value (e.g. encrypt)');
        it.todo('onRemove returning false blocks the delete');
        it.todo('onClear returning false blocks the clear');
        it.todo('onGet returning a value overrides the underlying read');
        it.todo('Storage.prototype.setItem.call(localStorage, k, v) ALSO goes through interceptor');
        it.todo('cookie set/remove flows through the same interceptor surface');
    });

    // ──────────────────────────────────────────────────────────────
    // navigation
    // ──────────────────────────────────────────────────────────────
    describe('navigation', () => {
        it.todo('onPush(url, state) returning false blocks history.pushState');
        it.todo('onPush can rewrite url before the push');
        it.todo('onReplace returning false blocks history.replaceState');
        it.todo('onAssign can intercept location.href setter');
        it.todo('onAssign can intercept location.assign()');
        it.todo('onAssign can intercept location.replace()');
        it.todo('onHash can intercept location.hash setter');
        it.todo('popstate / hashchange are observable but not interceptable');
    });

    // ──────────────────────────────────────────────────────────────
    // console & errors — observe-only, no interceptor needed
    // ──────────────────────────────────────────────────────────────
    describe('console / errors', () => {
        it.todo('console observer captures level + args without mutating output');
        it.todo('error observer captures uncaught errors with stack');
        it.todo('unhandledrejection observer captures rejected promises');
    });

    // ──────────────────────────────────────────────────────────────
    // context (ctx)
    // ──────────────────────────────────────────────────────────────
    describe('ctx surface', () => {
        it.todo('every interceptor receives ctx.initiator.stack (caller stack)');
        it.todo('every interceptor receives ctx.channel + ctx.kind');
        it.todo('ctx.moduleId is reserved (always undefined in runtime mode; populated by future build plugin)');
    });
});
