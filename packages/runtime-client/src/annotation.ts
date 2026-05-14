/**
 * In-page annotation overlay. Renders a floating action button (FAB) in the
 * bottom-right corner. Clicking it enters picker mode — the user hovers over
 * any element to highlight it, clicks to lock the selection, then types a
 * question. Submitting sends an `event` frame (`name: "task.submit"`) to the
 * daemon, where it lands in the in-memory task queue exposed via MCP tools.
 *
 * Everything renders inside a single Shadow DOM root attached to <body> so the
 * host page styles never leak in or out.
 */

import { EVENT_NAME, type TaskSubmitPayload } from '@morphixai/harnessa-fe.protocol';

const HOST_ID = '__harnessa_fe_annotation__';
const MAX_OUTER_HTML = 2048;

export interface AnnotationClient {
    sendEvent(name: string, payload: unknown): void;
}

export function installAnnotationOverlay(client: AnnotationClient): void {
    if (typeof window === 'undefined' || typeof document === 'undefined') return;
    if (document.getElementById(HOST_ID)) return;

    const host = document.createElement('div');
    host.id = HOST_ID;
    host.style.cssText = 'all: initial;';
    const root = host.attachShadow({ mode: 'open' });
    root.appendChild(buildStyle());
    const fab = buildFab();
    const highlight = buildHighlight();
    const panel = buildPanel();
    root.append(fab, highlight, panel);

    const mount = () => {
        if (!document.body) return false;
        document.body.appendChild(host);
        return true;
    };
    if (!mount()) {
        document.addEventListener('DOMContentLoaded', () => mount(), { once: true });
    }

    let pickerActive = false;
    let hoveredEl: Element | null = null;
    let lockedEl: Element | null = null;

    const setHighlight = (el: Element | null) => {
        if (!el || !(el instanceof HTMLElement || el instanceof SVGElement)) {
            highlight.style.display = 'none';
            return;
        }
        const rect = el.getBoundingClientRect();
        highlight.style.display = 'block';
        highlight.style.left = `${rect.left + window.scrollX}px`;
        highlight.style.top = `${rect.top + window.scrollY}px`;
        highlight.style.width = `${rect.width}px`;
        highlight.style.height = `${rect.height}px`;
    };

    const onMouseMove = (ev: MouseEvent) => {
        if (!pickerActive) return;
        const target = document.elementFromPoint(ev.clientX, ev.clientY);
        if (!target || target === host || host.contains(target)) {
            hoveredEl = null;
            highlight.style.display = 'none';
            return;
        }
        hoveredEl = target;
        setHighlight(target);
    };

    const onClickCapture = (ev: MouseEvent) => {
        if (!pickerActive) return;
        if (ev.target === host || host.contains(ev.target as Node)) return;
        ev.preventDefault();
        ev.stopPropagation();
        ev.stopImmediatePropagation();
        if (!hoveredEl) return;
        lockedEl = hoveredEl;
        exitPickerMode();
        showPanelFor(lockedEl);
    };

    const onKeyDown = (ev: KeyboardEvent) => {
        if (ev.key === 'Escape') {
            if (pickerActive) {
                exitPickerMode();
            } else if (panel.style.display === 'flex') {
                closePanel();
            }
        }
    };

    const enterPickerMode = () => {
        pickerActive = true;
        document.documentElement.style.cursor = 'crosshair';
        fab.dataset.state = 'active';
    };
    const exitPickerMode = () => {
        pickerActive = false;
        document.documentElement.style.cursor = '';
        fab.dataset.state = 'idle';
        highlight.style.display = 'none';
        hoveredEl = null;
    };

    const showPanelFor = (el: Element) => {
        setHighlight(el);
        const info = describeElement(el);
        panel.querySelector<HTMLElement>('[data-role=info]')!.textContent = info;
        const textarea = panel.querySelector<HTMLTextAreaElement>('textarea')!;
        textarea.value = '';
        panel.style.display = 'flex';
        setTimeout(() => textarea.focus(), 0);
    };
    const closePanel = () => {
        panel.style.display = 'none';
        lockedEl = null;
        highlight.style.display = 'none';
    };

    fab.addEventListener('click', () => {
        if (pickerActive) {
            exitPickerMode();
        } else {
            closePanel();
            enterPickerMode();
        }
    });

    panel.querySelector('[data-role=cancel]')!.addEventListener('click', () => closePanel());
    panel.querySelector('[data-role=submit]')!.addEventListener('click', () => {
        if (!lockedEl) return;
        const textarea = panel.querySelector<HTMLTextAreaElement>('textarea')!;
        const question = textarea.value.trim();
        if (!question) {
            textarea.focus();
            return;
        }
        const payload = buildPayload(lockedEl, question);
        client.sendEvent(EVENT_NAME.TASK_SUBMIT, payload);
        flashFab(fab);
        closePanel();
    });

    document.addEventListener('mousemove', onMouseMove, true);
    document.addEventListener('click', onClickCapture, true);
    document.addEventListener('keydown', onKeyDown, true);
}

function buildStyle(): HTMLStyleElement {
    const style = document.createElement('style');
    style.textContent = `
        :host { all: initial; }
        .fab {
            position: fixed;
            right: 20px;
            bottom: 20px;
            width: 44px;
            height: 44px;
            border-radius: 50%;
            background: #2563eb;
            color: #fff;
            border: none;
            cursor: pointer;
            box-shadow: 0 4px 14px rgba(37, 99, 235, 0.35);
            font: 600 18px/1 system-ui, sans-serif;
            display: flex;
            align-items: center;
            justify-content: center;
            z-index: 2147483646;
            transition: transform 0.15s ease, background 0.15s ease;
        }
        .fab:hover { transform: translateY(-1px); }
        .fab[data-state="active"] { background: #dc2626; }
        .fab[data-state="flash"] { background: #16a34a; }
        .highlight {
            position: absolute;
            pointer-events: none;
            border: 2px solid #2563eb;
            background: rgba(37, 99, 235, 0.08);
            border-radius: 2px;
            z-index: 2147483645;
            display: none;
            box-sizing: border-box;
        }
        .panel {
            position: fixed;
            right: 20px;
            bottom: 76px;
            width: 320px;
            background: #fff;
            color: #111;
            border: 1px solid #e5e7eb;
            border-radius: 10px;
            box-shadow: 0 12px 32px rgba(0, 0, 0, 0.18);
            padding: 14px;
            display: none;
            flex-direction: column;
            gap: 10px;
            z-index: 2147483646;
            font: 13px/1.4 system-ui, sans-serif;
        }
        .panel h3 { margin: 0; font-size: 13px; font-weight: 600; color: #111; }
        .panel .info {
            font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
            font-size: 11px;
            background: #f3f4f6;
            border-radius: 6px;
            padding: 6px 8px;
            color: #374151;
            word-break: break-all;
            max-height: 60px;
            overflow: auto;
        }
        .panel textarea {
            width: 100%;
            box-sizing: border-box;
            min-height: 80px;
            font: inherit;
            border: 1px solid #d1d5db;
            border-radius: 6px;
            padding: 8px;
            resize: vertical;
            outline: none;
        }
        .panel textarea:focus { border-color: #2563eb; }
        .panel .row { display: flex; justify-content: flex-end; gap: 8px; }
        .panel button {
            font: inherit;
            border-radius: 6px;
            padding: 6px 12px;
            cursor: pointer;
            border: 1px solid transparent;
        }
        .panel .cancel { background: #fff; border-color: #d1d5db; color: #374151; }
        .panel .submit { background: #2563eb; color: #fff; }
        .panel .submit:hover { background: #1d4ed8; }
    `;
    return style;
}

function buildFab(): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.className = 'fab';
    btn.dataset.state = 'idle';
    btn.title = 'Annotate · select an element and ask the agent';
    btn.setAttribute('aria-label', 'open annotation picker');
    btn.textContent = '?';
    return btn;
}

function buildHighlight(): HTMLDivElement {
    const div = document.createElement('div');
    div.className = 'highlight';
    return div;
}

function buildPanel(): HTMLDivElement {
    const panel = document.createElement('div');
    panel.className = 'panel';
    panel.innerHTML = `
        <h3>Ask agent about this element</h3>
        <div class="info" data-role="info"></div>
        <textarea placeholder="What's wrong? What should the agent do?"></textarea>
        <div class="row">
            <button class="cancel" data-role="cancel" type="button">Cancel</button>
            <button class="submit" data-role="submit" type="button">Submit</button>
        </div>
    `;
    return panel;
}

function describeElement(el: Element): string {
    const tag = el.tagName.toLowerCase();
    const comp = el.getAttribute('data-morphix-comp');
    const loc = el.getAttribute('data-morphix-loc');
    const aria = el.getAttribute('aria-label');
    const parts = [tag];
    if (comp) parts.push(`comp=${comp}`);
    if (loc) parts.push(`loc=${loc}`);
    if (aria) parts.push(`aria="${aria}"`);
    return parts.join(' · ');
}

function buildPayload(el: Element, question: string): TaskSubmitPayload {
    const rect = el.getBoundingClientRect();
    return {
        question,
        url: location.href,
        selector: {
            comp: el.getAttribute('data-morphix-comp') ?? undefined,
            loc: el.getAttribute('data-morphix-loc') ?? undefined,
            css: buildCssPath(el),
        },
        element: {
            tag: el.tagName.toLowerCase(),
            outerHTML: truncate(el.outerHTML, MAX_OUTER_HTML),
            rect: {
                x: rect.x,
                y: rect.y,
                width: rect.width,
                height: rect.height,
            },
        },
    };
}

function truncate(s: string, n: number): string {
    return s.length <= n ? s : `${s.slice(0, n)}…`;
}

/**
 * Build a best-effort CSS-ish path used as a fallback when `comp` / `loc` are
 * absent. Two notable behaviors:
 *   - Depth cap is 12 (was 6) so deeper trees still produce a unique path; an
 *     `id` anchor short-circuits earlier.
 *   - Shadow-DOM aware: when the parent chain crosses a ShadowRoot we emit a
 *     ` >>> ` combinator and continue from the host element. The combinator is
 *     not valid CSS (shadow DOM is opaque to `querySelector`) — it's a marker
 *     so downstream agents can see the boundary and pick a different strategy.
 */
export function buildCssPath(el: Element): string {
    const segments: string[] = [];
    // The leading segment is a normal CSS path; whenever we cross a shadow
    // boundary we close the current segment and start a new one. We finally
    // join with ` >>> ` between segments.
    let current: string[] = [];
    let cur: Element | null = el;
    let depth = 0;
    const MAX_DEPTH = 12;

    while (cur && cur.nodeType === 1 && depth < MAX_DEPTH) {
        const node: Element = cur;
        let part = node.tagName.toLowerCase();
        if (node.id) {
            current.unshift(`${part}#${node.id}`);
            break;
        }
        const parentElement: Element | null = node.parentElement;
        if (parentElement) {
            const siblings: Element[] = Array.from(parentElement.children).filter(
                (c: Element) => c.tagName === node.tagName,
            );
            if (siblings.length > 1) {
                const idx = siblings.indexOf(node) + 1;
                part += `:nth-of-type(${idx})`;
            }
            current.unshift(part);
            cur = parentElement;
            depth++;
            continue;
        }
        // No parentElement — either we're at <html> or sitting inside a
        // ShadowRoot. Detect the latter via parentNode.
        const parentNode = node.parentNode;
        if (parentNode && parentNode instanceof ShadowRoot) {
            current.unshift(part);
            segments.unshift(current.join(' > '));
            current = [];
            cur = parentNode.host;
            depth++;
            continue;
        }
        current.unshift(part);
        break;
    }

    if (current.length) segments.unshift(current.join(' > '));
    return segments.join(' >>> ');
}

function flashFab(fab: HTMLButtonElement): void {
    fab.dataset.state = 'flash';
    setTimeout(() => {
        if (fab.dataset.state === 'flash') fab.dataset.state = 'idle';
    }, 600);
}
