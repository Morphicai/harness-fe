/**
 * Built-in command handlers run in the page. Each receives parsed args and
 * returns a serializable result that gets shipped back in a ResponseFrame.
 */

import {
    COMMAND,
    type ClickArgs,
    type EvaluateArgs,
    type NavigateArgs,
    type ReloadArgs,
    type ScreenshotArgs,
    type ScrollArgs,
    type SetHtmlArgs,
    type SetStyleArgs,
    type Selector,
    type TypeArgs,
    type WaitForArgs,
} from '@harness-fe/protocol';
import { snapdom } from '@zumer/snapdom';
import { resolveSelector } from './selectors.js';
import type { CaptureStore } from './capture.js';

export interface CommandContext {
    capture: CaptureStore;
}

export type CommandHandler = (args: unknown, ctx: CommandContext) => Promise<unknown>;

const HTML_TRUNCATE = 4000;

function describeNoMatch(selector: Selector): string {
    const fields = Object.entries(selector)
        .filter(([, v]) => v !== undefined)
        .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
        .join(' ');
    return `no element matched selector: ${fields}`;
}

export const commandHandlers: Record<string, CommandHandler> = {
    [COMMAND.PAGE_CLICK]: async (raw) => {
        const args = raw as ClickArgs;
        const result = resolveSelector(args.selector);
        if (!result.element) throw new Error(describeNoMatch(args.selector));
        const target = result.element as HTMLElement;

        // When the resolved element is not itself an <a>, walk up to find the
        // nearest anchor ancestor. This handles the common case where a text
        // selector matches a child <span> inside a React Router <Link>, which
        // would otherwise fire a click that bypasses the router's onClick handler.
        let clickTarget: HTMLElement = target;
        if (target.tagName !== 'A') {
            const anchor = target.closest('a');
            if (anchor) clickTarget = anchor as HTMLElement;
        }

        // Dispatch a proper MouseEvent instead of calling .click() so that
        // framework routers (React Router, Vue Router) receive a bubbling event
        // with the correct button/modifier state they check before navigating.
        clickTarget.dispatchEvent(
            new MouseEvent('click', {
                bubbles: true,
                cancelable: true,
                view: window,
                button: args.button === 'right' ? 2 : args.button === 'middle' ? 1 : 0,
            }),
        );
        return { via: result.via, tag: clickTarget.tagName.toLowerCase() };
    },

    [COMMAND.PAGE_TYPE]: async (raw) => {
        const args = raw as TypeArgs;
        const result = resolveSelector(args.selector);
        if (!result.element) throw new Error(describeNoMatch(args.selector));
        const target = result.element as HTMLInputElement | HTMLTextAreaElement;
        if (typeof target.value !== 'string') {
            throw new Error('page.type: target element does not support .value');
        }
        // React (and Vue's controlled inputs) install setters/trackers on
        // input.value. Setting `.value = '...'` directly bypasses them, so
        // their state never updates. Use the native prototype setter so the
        // framework's tracker registers the change, then dispatch a bubbling
        // 'input' + 'change' event.
        const proto =
            target instanceof HTMLInputElement
                ? HTMLInputElement.prototype
                : HTMLTextAreaElement.prototype;
        const nativeSetter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
        const next = args.clear !== false ? args.value : target.value + args.value;
        if (nativeSetter) nativeSetter.call(target, next);
        else target.value = next;
        target.dispatchEvent(new Event('input', { bubbles: true }));
        target.dispatchEvent(new Event('change', { bubbles: true }));
        return { via: result.via, value: target.value };
    },

    [COMMAND.PAGE_EVALUATE]: async (raw) => {
        const args = raw as EvaluateArgs;
        // eslint-disable-next-line no-new-func
        const fn = new Function(`return (async () => { return (${args.expr}); })();`) as () => Promise<unknown>;
        const value = await fn();
        return { value: safeJson(value) };
    },

    [COMMAND.PAGE_WAIT_FOR]: async (raw) => {
        const args = raw as WaitForArgs;
        const timeoutMs = args.timeoutMs ?? 10_000;
        const deadline = Date.now() + timeoutMs;
        const isBuiltin = args.predicate === 'network.idle' || args.predicate === 'dom.ready';
        // eslint-disable-next-line no-new-func
        const probe = !isBuiltin
            ? (new Function(`return Boolean(${args.predicate})`) as () => boolean)
            : undefined;

        while (Date.now() < deadline) {
            if (args.predicate === 'dom.ready' && document.readyState === 'complete') {
                return { ok: true, after: Date.now() };
            }
            if (args.predicate === 'network.idle') {
                // Crude heuristic — we don't have a real idle tracker yet.
                await new Promise((r) => setTimeout(r, 200));
                return { ok: true, after: Date.now() };
            }
            if (probe && probe()) return { ok: true, after: Date.now() };
            await new Promise((r) => setTimeout(r, 50));
        }
        throw new Error(`page.wait_for: predicate "${args.predicate}" did not become truthy in ${timeoutMs}ms`);
    },

    [COMMAND.PAGE_SCREENSHOT]: async (raw) => {
        const args = raw as ScreenshotArgs;
        const format = args.format ?? 'webp';
        const maxWidth = args.maxWidth ?? 1280;
        // Default to opaque white so transparent pages don't render a blank
        // screenshot. Callers can pass `null` to opt back into transparency.
        // JPEG has no alpha channel so the field is effectively always set.
        const backgroundColor =
            args.backgroundColor === null
                ? undefined
                : (args.backgroundColor ?? (format === 'jpeg' ? '#fff' : '#ffffff'));

        let target: Element;
        let via = 'document';
        if (args.selector) {
            const result = resolveSelector(args.selector);
            if (!result.element) throw new Error(describeNoMatch(args.selector));
            target = result.element;
            via = result.via;
        } else {
            target = document.documentElement;
        }

        const rect = target.getBoundingClientRect();
        const naturalWidth = Math.max(1, Math.round(rect.width || target.clientWidth || window.innerWidth));
        const width = naturalWidth > maxWidth ? maxWidth : naturalWidth;

        // Hide our own overlay during capture so the screenshot reflects the
        // real page state. Without this, the floating "H" FAB and any open
        // info card would always end up in the corner of every shot.
        const overlayHost = document.getElementById('__harness_fe_overlay__') as HTMLElement | null;
        const prevVisibility = overlayHost?.style.visibility ?? '';
        if (overlayHost) overlayHost.style.visibility = 'hidden';

        try {
            const result = await snapdom(target as HTMLElement, {
                fast: true,
                width,
                backgroundColor,
            });
            const canvas = await result.toCanvas();
            const mime = format === 'jpeg' ? 'image/jpeg' : `image/${format}`;
            const quality = format === 'png' ? undefined : 0.85;
            const dataUrl = canvas.toDataURL(mime, quality);
            return {
                via,
                format,
                width: canvas.width,
                height: canvas.height,
                dataUrl,
            };
        } finally {
            if (overlayHost) overlayHost.style.visibility = prevVisibility;
        }
    },

    [COMMAND.PAGE_DOM_QUERY]: async (raw) => {
        const args = raw as { selector: Selector; limit?: number };
        const limit = args.limit ?? 5;
        const matches: Array<{ html: string; tag: string; via: string }> = [];
        // Try each selector field independently — we want all matches up to limit.
        if (args.selector.css) {
            const list = document.querySelectorAll(args.selector.css);
            for (let i = 0; i < list.length && matches.length < limit; i++) {
                matches.push({
                    html: truncate((list[i] as Element).outerHTML, HTML_TRUNCATE),
                    tag: (list[i] as Element).tagName.toLowerCase(),
                    via: 'css',
                });
            }
        }
        if (matches.length < limit) {
            const result = resolveSelector(args.selector);
            if (result.element) {
                matches.push({
                    html: truncate(result.element.outerHTML, HTML_TRUNCATE),
                    tag: result.element.tagName.toLowerCase(),
                    via: result.via,
                });
            }
        }
        return { matches };
    },

    [COMMAND.PAGE_SCROLL]: async (raw) => {
        const args = raw as ScrollArgs;
        const behavior = args.behavior ?? 'smooth';
        if (args.selector) {
            const result = resolveSelector(args.selector);
            if (!result.element) throw new Error(describeNoMatch(args.selector));
            (result.element as HTMLElement).scrollIntoView({ behavior, block: 'center' });
            return { via: result.via, scrolledIntoView: true };
        }
        window.scrollTo({ top: args.y ?? 0, left: args.x ?? 0, behavior });
        return { scrollX: window.scrollX, scrollY: window.scrollY };
    },

    [COMMAND.PAGE_NAVIGATE]: async (raw) => {
        const args = raw as NavigateArgs;
        const method = args.method ?? 'href';
        const before = location.href;
        if (method === 'href') {
            location.href = args.url;
            return { method, from: before, to: args.url };
        }
        if (method === 'push') {
            history.pushState({}, '', args.url);
        } else {
            history.replaceState({}, '', args.url);
        }
        // Notify SPA routers that listen on popstate
        window.dispatchEvent(new PopStateEvent('popstate', { state: history.state }));
        return { method, from: before, to: location.href };
    },

    [COMMAND.PAGE_RELOAD]: async (raw) => {
        const args = raw as ReloadArgs;
        if (args.hard) {
            // Hard reload — bypass cache
            location.reload();
        } else {
            location.reload();
        }
        return { reloading: true };
    },

    [COMMAND.PAGE_SET_HTML]: async (raw) => {
        const args = raw as SetHtmlArgs;
        const result = resolveSelector(args.selector);
        if (!result.element) throw new Error(describeNoMatch(args.selector));
        const el = result.element as HTMLElement;
        const target = args.target ?? 'innerHTML';
        const before = target === 'innerHTML' ? el.innerHTML : el.outerHTML;
        if (target === 'innerHTML') {
            el.innerHTML = args.html;
            return { via: result.via, target, before: truncate(before, 500) };
        }
        // outerHTML replacement — the element is removed from the DOM; return the new element tag
        const tag = el.tagName.toLowerCase();
        el.outerHTML = args.html;
        return { via: result.via, target, replacedTag: tag, before: truncate(before, 500) };
    },

    [COMMAND.PAGE_SET_STYLE]: async (raw) => {
        const args = raw as SetStyleArgs;

        // Global injection mode: { rule: "<raw css>" }
        if (!args.selector) {
            const rule = args.styles['rule'];
            if (!rule) throw new Error('page.set_style: pass { rule: "<css>" } when no selector is provided');
            const styleId = '__hfe_injected_style__';
            let styleEl = document.getElementById(styleId) as HTMLStyleElement | null;
            if (!styleEl) {
                styleEl = document.createElement('style');
                styleEl.id = styleId;
                document.head.appendChild(styleEl);
            }
            styleEl.textContent += `\n${rule}`;
            return { injected: true, rule };
        }

        // Element inline-style mode
        const result = resolveSelector(args.selector);
        if (!result.element) throw new Error(describeNoMatch(args.selector));
        const el = result.element as HTMLElement;
        const merge = args.merge !== false; // default true
        if (!merge) el.removeAttribute('style');
        const applied: Record<string, string> = {};
        for (const [prop, value] of Object.entries(args.styles)) {
            // Accept both camelCase and kebab-case
            const camel = prop.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
            (el.style as unknown as Record<string, string>)[camel] = value;
            applied[camel] = value;
        }
        return { via: result.via, applied, currentStyle: el.getAttribute('style') };
    },

    [COMMAND.CONSOLE_TAIL]: async (raw, ctx) => {
        const args = raw as TailArgs & { level?: string };
        const all = ctx.capture.console.tail(args.n ?? 20);
        return { entries: filterTail(all, args, (e) => {
            if (args.level && e.level !== args.level) return undefined;
            return JSON.stringify({ level: e.level, args: e.args });
        }) };
    },

    [COMMAND.NETWORK_TAIL]: async (raw, ctx) => {
        const args = raw as TailArgs & {
            urlContains?: string;
            method?: string;
            statusCode?: number;
        };
        const all = ctx.capture.network.tail(args.n ?? 20);
        return { entries: filterTail(all, args, (e) => {
            if (args.urlContains && !e.url.includes(args.urlContains)) return undefined;
            if (args.method && e.method.toUpperCase() !== args.method.toUpperCase()) return undefined;
            if (args.statusCode !== undefined && e.status !== args.statusCode) return undefined;
            return JSON.stringify({ url: e.url, method: e.method, requestBody: e.requestBody, responseBody: e.responseBody });
        }) };
    },

    [COMMAND.ERRORS_TAIL]: async (raw, ctx) => {
        const args = raw as TailArgs;
        const all = ctx.capture.errors.tail(args.n ?? 20);
        return { entries: filterTail(all, args, (e) =>
            JSON.stringify({ message: e.message, stack: e.stack, source: e.source }),
        ) };
    },

    [COMMAND.WS_TAIL]: async (raw, ctx) => {
        const args = raw as TailArgs & { phase?: string };
        const all = ctx.capture.ws.tail(args.n ?? 20);
        return { entries: filterTail(all, args, (e) => {
            if (args.phase && e.phase !== args.phase) return undefined;
            return JSON.stringify({ url: e.url, payload: e.payload, reason: e.reason });
        }) };
    },

    [COMMAND.NETWORK_WAIT_FOR]: async (raw, ctx) => {
        const args = raw as {
            urlContains?: string;
            urlRegex?: string;
            method?: string;
            statusCode?: number;
            timeoutMs?: number;
        };
        const timeoutMs = args.timeoutMs ?? 10_000;
        const deadline = Date.now() + timeoutMs;
        const regex = args.urlRegex ? safeRegex(args.urlRegex) : undefined;
        // Anchor on the existing buffer head so we only consider new requests
        // (otherwise an old matching entry would resolve immediately).
        const baselineLen = ctx.capture.network.size();
        while (Date.now() < deadline) {
            const all = ctx.capture.network.tail(500);
            const newOnes = all.slice(Math.max(0, all.length - (ctx.capture.network.size() - baselineLen)));
            for (const e of newOnes) {
                if (args.urlContains && !e.url.includes(args.urlContains)) continue;
                if (regex && !regex.test(e.url)) continue;
                if (args.method && e.method.toUpperCase() !== args.method.toUpperCase()) continue;
                if (args.statusCode !== undefined && e.status !== args.statusCode) continue;
                return { ok: true, entry: e, after: Date.now() };
            }
            await new Promise((r) => setTimeout(r, 50));
        }
        throw new Error(`network.wait_for: no matching request within ${timeoutMs}ms`);
    },

    [COMMAND.NETWORK_WAIT_FOR_IDLE]: async (raw, ctx) => {
        const args = raw as { idleMs?: number; timeoutMs?: number };
        const idleMs = args.idleMs ?? 500;
        const timeoutMs = args.timeoutMs ?? 10_000;
        const deadline = Date.now() + timeoutMs;
        let lastSize = ctx.capture.network.size();
        let stableSince = Date.now();
        while (Date.now() < deadline) {
            const currentSize = ctx.capture.network.size();
            if (currentSize !== lastSize) {
                lastSize = currentSize;
                stableSince = Date.now();
            } else if (Date.now() - stableSince >= idleMs) {
                return { ok: true, idleFor: Date.now() - stableSince, after: Date.now() };
            }
            await new Promise((r) => setTimeout(r, 50));
        }
        throw new Error(`network.wait_for_idle: never quiet for ${idleMs}ms within ${timeoutMs}ms`);
    },

    [COMMAND.NETWORK_GET]: async (raw, ctx) => {
        const args = raw as { reqId: string };
        // Return both req + res entries for this id (one or both may exist).
        const all = ctx.capture.network.tail(200);
        const matches = all.filter((e) => e.id === args.reqId);
        return { entries: matches, found: matches.length > 0 };
    },

    [COMMAND.WS_GET]: async (raw, ctx) => {
        const args = raw as { wsId: string };
        const all = ctx.capture.ws.tail(200);
        const matches = all.filter((e) => e.id === args.wsId);
        return { entries: matches, found: matches.length > 0 };
    },

    [COMMAND.STORAGE_TAIL]: async (raw, ctx) => {
        const args = raw as TailArgs & {
            which?: string;
            op?: string;
            key?: string;
        };
        const all = ctx.capture.storage.tail(args.n ?? 20);
        return { entries: filterTail(all, args, (e) => {
            if (args.which && e.which !== args.which) return undefined;
            if (args.op && e.op !== args.op) return undefined;
            if (args.key && e.key !== args.key) return undefined;
            return JSON.stringify({ op: e.op, which: e.which, key: e.key, value: e.value });
        }) };
    },
};

interface TailArgs {
    n?: number;
    filter?: string;
    match?: 'contains' | 'regex';
}

/**
 * Apply caller-supplied filtering to a tail() result. `pickHaystack` returns
 * the string to match against (or `undefined` to drop the entry due to a
 * type-specific narrow like `level` / `urlContains`). The shared `filter`
 * string then runs as substring (default) or regex against the haystack.
 */
function safeRegex(source: string): RegExp | undefined {
    try {
        return new RegExp(source, 'i');
    } catch {
        return undefined;
    }
}

function filterTail<T>(
    items: T[],
    args: TailArgs,
    pickHaystack: (item: T) => string | undefined,
): T[] {
    const filter = args.filter?.trim();
    const useRegex = args.match === 'regex';
    let regex: RegExp | undefined;
    if (filter && useRegex) {
        try {
            regex = new RegExp(filter, 'i');
        } catch {
            // Invalid regex: fall back to substring match rather than throwing.
            regex = undefined;
        }
    }
    const out: T[] = [];
    for (const item of items) {
        const haystack = pickHaystack(item);
        if (haystack === undefined) continue;
        if (filter) {
            if (regex) {
                if (!regex.test(haystack)) continue;
            } else {
                if (!haystack.toLowerCase().includes(filter.toLowerCase())) continue;
            }
        }
        out.push(item);
    }
    return out;
}

function truncate(s: string, n: number): string {
    if (s.length <= n) return s;
    return `${s.slice(0, n)}… (truncated, total ${s.length} chars)`;
}

function safeJson(value: unknown): unknown {
    if (value === undefined) return null;
    try {
        return JSON.parse(JSON.stringify(value));
    } catch {
        return String(value);
    }
}
