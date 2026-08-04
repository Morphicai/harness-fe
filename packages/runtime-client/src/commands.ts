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
    uploadArgsSchema,
    selectArgsSchema,
    checkArgsSchema,
    pasteArgsSchema,
    dialogHandlerSchema,
} from '@harness-fe/protocol';
import { snapdom } from '@zumer/snapdom';
import { resolveSelector } from './selectors.js';
import { resetRefs, assignRef } from './refs.js';
import type { CaptureStore } from './capture.js';

export interface CommandContext {
    capture: CaptureStore;
}

/**
 * Pre-registered dialog responses keyed by dialog type ('alert' | 'confirm' | 'prompt').
 * Written by the SET_DIALOG_HANDLER command; read synchronously by the dialogs interception layer.
 */
export const dialogPresets = new Map<string, boolean | string>();

export type CommandHandler = (args: unknown, ctx: CommandContext) => Promise<unknown>;

const HTML_TRUNCATE = 4000;

function describeNoMatch(selector: Selector): string {
    const fields = Object.entries(selector)
        .filter(([, v]) => v !== undefined)
        .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
        .join(' ');
    return `no element matched selector: ${fields}`;
}

/**
 * Dispatch the full pointerdown → mousedown → pointerup → mouseup → click
 * sequence a real click gesture produces, instead of a single bare 'click'.
 * Portal-based menus (Radix UI Popover/DropdownMenu and similar) gate their
 * open logic on 'pointerdown', so a lone 'click' event never triggers them.
 * These are still script-dispatched (isTrusted: false) — browsers refuse to
 * mark synthetic events as trusted — but matching the real event sequence
 * satisfies listeners that key off event type rather than trust.
 */
/**
 * snapdom (the DOM→canvas library page.screenshot uses) walks the DOM tree,
 * so it can't represent content that isn't part of that tree the same way a
 * real compositor capture would: a tainted <canvas> (cross-origin-drawn
 * pixels), a <video> frame, or a cross-origin <iframe>'s own document. It
 * fails silently on all three (internal try/catch, console.warn only) — a
 * blank region in the result looks identical to "this area is genuinely
 * empty," which is a correctness trap for an agent (harness-fe#205). Scan the
 * capture target beforehand so the response can say what it couldn't get.
 */
function findUncapturableElements(target: Element): Array<{ tag: 'canvas' | 'video' | 'iframe'; selector?: string }> {
    const notCaptured: Array<{ tag: 'canvas' | 'video' | 'iframe'; selector?: string }> = [];
    const describe = (el: Element): string | undefined => (el.id ? `#${el.id}` : undefined);

    for (const canvas of target.querySelectorAll('canvas')) {
        try {
            (canvas as HTMLCanvasElement).toDataURL();
        } catch {
            notCaptured.push({ tag: 'canvas', selector: describe(canvas) });
        }
    }
    for (const video of target.querySelectorAll('video')) {
        const v = video as HTMLVideoElement;
        if (v.readyState < 2) {
            notCaptured.push({ tag: 'video', selector: describe(v) });
            continue;
        }
        try {
            const probe = document.createElement('canvas');
            probe.getContext('2d')?.drawImage(v, 0, 0, 1, 1);
            probe.toDataURL();
        } catch {
            notCaptured.push({ tag: 'video', selector: describe(v) });
        }
    }
    for (const iframe of target.querySelectorAll('iframe')) {
        const f = iframe as HTMLIFrameElement;
        let sameOrigin = false;
        try {
            sameOrigin = !!(f.contentDocument || f.contentWindow?.document);
        } catch {
            sameOrigin = false;
        }
        if (!sameOrigin) notCaptured.push({ tag: 'iframe', selector: describe(f) });
    }
    return notCaptured;
}

function dispatchClickSequence(target: HTMLElement, button: 'left' | 'right' | 'middle' | undefined): void {
    const buttonNum = button === 'right' ? 2 : button === 'middle' ? 1 : 0;
    const rect = target.getBoundingClientRect();
    const clientX = rect.left + rect.width / 2;
    const clientY = rect.top + rect.height / 2;
    const shared = {
        bubbles: true,
        cancelable: true,
        view: window,
        button: buttonNum,
        buttons: 1,
        clientX,
        clientY,
    };

    target.dispatchEvent(
        new PointerEvent('pointerdown', { ...shared, pointerId: 1, pointerType: 'mouse', isPrimary: true }),
    );
    target.dispatchEvent(new MouseEvent('mousedown', shared));
    target.dispatchEvent(
        new PointerEvent('pointerup', { ...shared, pointerId: 1, pointerType: 'mouse', isPrimary: true }),
    );
    target.dispatchEvent(new MouseEvent('mouseup', shared));
    target.dispatchEvent(new MouseEvent('click', shared));
}

/**
 * Real network-idle detection: polls the capture store's live in-flight
 * fetch/xhr count (incremented on request start, decremented on
 * response/error — see CaptureStore.inFlightCount) until it has been zero
 * for `idleMs`, instead of a fixed sleep or "no new entries pushed"
 * heuristic (harness-fe#206 — both were racy: too short for a page whose
 * slow request starts just after the window, too long for a page that's
 * already idle, and the entries-pushed heuristic falsely reports idle the
 * moment a request starts, before its response arrives).
 */
async function waitForNetworkIdle(
    capture: CaptureStore,
    idleMs: number,
    deadline: number,
): Promise<{ ok: true; idleFor: number; after: number }> {
    let stableSince = capture.inFlightCount() === 0 ? Date.now() : undefined;
    while (Date.now() < deadline) {
        if (capture.inFlightCount() === 0) {
            stableSince ??= Date.now();
            const idleFor = Date.now() - stableSince;
            if (idleFor >= idleMs) return { ok: true, idleFor, after: Date.now() };
        } else {
            stableSince = undefined;
        }
        await new Promise((r) => setTimeout(r, 50));
    }
    throw new Error(`network never quiet for ${idleMs}ms within timeout`);
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

        dispatchClickSequence(clickTarget, args.button);
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

    [COMMAND.PAGE_SELECT]: async (raw) => {
        const { selector, value } = selectArgsSchema.parse(raw);
        const result = resolveSelector(selector);
        if (!result.element) throw new Error(`page.select: element not found for selector ${JSON.stringify(selector)}`);
        const select = result.element as HTMLSelectElement;
        select.value = value;
        select.dispatchEvent(new Event('change', { bubbles: true }));
        select.dispatchEvent(new Event('input', { bubbles: true }));
        return { via: result.via, value };
    },

    [COMMAND.PAGE_CHECK]: async (raw) => {
        const { selector, checked } = checkArgsSchema.parse(raw);
        const result = resolveSelector(selector);
        if (!result.element) throw new Error(`page.check: element not found for selector ${JSON.stringify(selector)}`);
        const input = result.element as HTMLInputElement;
        if (input.tagName !== 'INPUT' || !['checkbox', 'radio'].includes(input.type)) {
            throw new Error(`page.check: target must be <input type="checkbox"> or <input type="radio">`);
        }
        input.checked = checked;
        input.dispatchEvent(new Event('change', { bubbles: true }));
        input.dispatchEvent(new Event('input', { bubbles: true }));
        return { via: result.via, checked };
    },

    [COMMAND.PAGE_UPLOAD]: async (raw) => {
        const { selector, files } = uploadArgsSchema.parse(raw);
        const result = resolveSelector(selector);
        if (!result.element) throw new Error(`page.upload: element not found for selector ${JSON.stringify(selector)}`);
        const input = result.element as HTMLInputElement;
        if (input.tagName !== 'INPUT' || input.type !== 'file') {
            throw new Error('page.upload: target must be <input type="file">');
        }
        const dt = new DataTransfer();
        for (const f of files) {
            const bytes = Uint8Array.from(atob(f.content), c => c.charCodeAt(0));
            dt.items.add(new File([bytes], f.name, { type: f.mimeType ?? 'application/octet-stream' }));
        }
        // configurable:true ensures the browser can overwrite this when the user picks a real file
        Object.defineProperty(input, 'files', { value: dt.files, writable: true, configurable: true });
        // Mark the input so the forms sandbox channel can inject files into FormData/submit.
        (input as unknown as Record<string, unknown>).__hfe_injected_files__ = dt.files;
        // Auto-clear after 60 s in case the form is never submitted.
        setTimeout(() => {
            if ((input as unknown as Record<string, unknown>).__hfe_injected_files__ === dt.files) {
                delete (input as unknown as Record<string, unknown>).__hfe_injected_files__;
            }
        }, 60_000);
        input.dispatchEvent(new Event('change', { bubbles: true }));
        input.dispatchEvent(new Event('input', { bubbles: true }));
        return { via: result.via, fileCount: files.length };
    },

    [COMMAND.PAGE_PASTE]: async (raw) => {
        const { selector, content, html } = pasteArgsSchema.parse(raw);
        const result = resolveSelector(selector);
        if (!result.element) throw new Error(`page.paste: element not found for selector ${JSON.stringify(selector)}`);
        const dt = new DataTransfer();
        dt.setData('text/plain', content);
        if (html) dt.setData('text/html', html);
        result.element.dispatchEvent(new ClipboardEvent('paste', {
            bubbles: true,
            cancelable: true,
            clipboardData: dt,
        }));
        return { via: result.via, length: content.length };
    },

    [COMMAND.SET_DIALOG_HANDLER]: async (raw) => {
        const { type, value } = dialogHandlerSchema.parse(raw);
        if (value === undefined) {
            dialogPresets.delete(type);
        } else {
            dialogPresets.set(type, value);
        }
        return { type, value };
    },

    [COMMAND.PAGE_EVALUATE]: async (raw) => {
        const args = raw as EvaluateArgs;
        // eslint-disable-next-line no-new-func
        const fn = new Function(`return (async () => { return (${args.expr}); })();`) as () => Promise<unknown>;
        const value = await fn();
        return { value: safeJson(value) };
    },

    [COMMAND.PAGE_WAIT_FOR]: async (raw, ctx) => {
        const args = raw as WaitForArgs;
        const timeoutMs = args.timeoutMs ?? 10_000;
        const deadline = Date.now() + timeoutMs;

        if (args.predicate === 'network.idle') {
            try {
                return await waitForNetworkIdle(ctx.capture, args.idleMs ?? 500, deadline);
            } catch {
                throw new Error(`page.wait_for: network never went idle within ${timeoutMs}ms`);
            }
        }

        const isBuiltin = args.predicate === 'dom.ready';
        // eslint-disable-next-line no-new-func
        const probe = !isBuiltin
            ? (new Function(`return Boolean(${args.predicate})`) as () => boolean)
            : undefined;

        while (Date.now() < deadline) {
            if (args.predicate === 'dom.ready' && document.readyState === 'complete') {
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
            const notCaptured = findUncapturableElements(target);
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
                notCaptured,
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

    // Compact, token-bounded index of clickable elements (harness-fe#202) —
    // deliberately narrow (only <a>/<button>) rather than a full accessibility
    // tree. Each element gets a short-lived `ref` (e1, e2, ...) usable via
    // `{selector: {ref}}` in page.click/page.type; refs invalidate on the next
    // snapshot call, same as agent-browser's Snapshot+Refs.
    [COMMAND.PAGE_SNAPSHOT]: async (raw) => {
        const args = raw as { limit?: number };
        const limit = args.limit ?? 50;

        resetRefs();
        const candidates = Array.from(document.querySelectorAll<HTMLElement>('a, button'));
        const visible = candidates.filter((el) => {
            if (el.hidden) return false;
            const style = getComputedStyle(el);
            return style.display !== 'none' && style.visibility !== 'hidden';
        });

        const elements: Array<{
            ref: string;
            tag: 'a' | 'button';
            text: string;
            href?: string;
            ariaLabel?: string;
            disabled?: boolean;
        }> = [];
        for (const el of visible.slice(0, limit)) {
            const tag = el.tagName.toLowerCase() as 'a' | 'button';
            const ref = assignRef(el);
            const text = truncate((el.textContent ?? '').trim().replace(/\s+/g, ' '), 80);
            const entry: (typeof elements)[number] = { ref, tag, text };
            const ariaLabel = el.getAttribute('aria-label');
            if (ariaLabel) entry.ariaLabel = ariaLabel;
            if (tag === 'a') {
                const href = (el as HTMLAnchorElement).getAttribute('href');
                if (href) entry.href = href;
            } else if ((el as HTMLButtonElement).disabled) {
                entry.disabled = true;
            }
            elements.push(entry);
        }

        return {
            url: location.href,
            elements,
            truncated: visible.length > limit,
            total: visible.length,
        };
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
        try {
            return await waitForNetworkIdle(ctx.capture, idleMs, deadline);
        } catch {
            throw new Error(`network.wait_for_idle: never quiet for ${idleMs}ms within ${timeoutMs}ms`);
        }
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

    [COMMAND.NAVIGATION_TAIL]: async (raw, ctx) => {
        const args = raw as TailArgs & { kind?: string };
        const all = ctx.capture.navigation.tail(args.n ?? 20);
        return { entries: filterTail(all, args, (e) => {
            if (args.kind && e.kind !== args.kind) return undefined;
            return JSON.stringify({ kind: e.kind, url: e.url, replace: e.replace });
        }) };
    },

    [COMMAND.GLOBALS_TAIL]: async (raw, ctx) => {
        const args = raw as TailArgs & { op?: string; key?: string };
        const all = ctx.capture.globals.tail(args.n ?? 20);
        return { entries: filterTail(all, args, (e) => {
            if (args.op && e.op !== args.op) return undefined;
            if (args.key && e.key !== args.key) return undefined;
            return JSON.stringify({ op: e.op, key: e.key, value: e.value });
        }) };
    },

    [COMMAND.INDEXEDDB_TAIL]: async (raw, ctx) => {
        const args = raw as TailArgs & { op?: string; store?: string; db?: string };
        const all = ctx.capture.indexeddb.tail(args.n ?? 20);
        return { entries: filterTail(all, args, (e) => {
            if (args.op && e.op !== args.op) return undefined;
            if (args.store && e.store !== args.store) return undefined;
            if (args.db && e.db !== args.db) return undefined;
            return JSON.stringify({ op: e.op, store: e.store, key: e.key });
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
