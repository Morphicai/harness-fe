/**
 * In-page overlay — single floating "H" mark in the bottom-right corner.
 *
 * Click → expands into an info card that surfaces:
 *   - project / buildId / connection status
 *   - sessionId / tabId (click-to-copy)
 *   - current URL
 *   - "Copy snapshot" — key fields as markdown for sharing with a teammate
 *     or pasting into an agent prompt
 *   - "Report a problem" — enters element-picker mode (the legacy annotation
 *     flow, now reachable from inside the card so users don't see two FABs)
 *
 * Single Shadow DOM root attached to <body>; host page styles never leak in
 * or out. State machine: idle → info → (picker → question) → flash → idle.
 */

import { EVENT_NAME, type TaskSubmitPayload } from '@harnessa-fe/protocol';

const HOST_ID = '__harnessa_fe_overlay__';
const MAX_OUTER_HTML = 2048;

export interface OverlayClient {
    readonly projectId: string;
    readonly buildId?: string;
    readonly displayName?: string;
    readonly tabId: string;
    readonly sessionId: string;
    readonly parentProjectId?: string;
    getConnectionState(): 'connecting' | 'open' | 'closed';
    sendEvent(name: string, payload: unknown): void;
}

export function installOverlay(client: OverlayClient): void {
    if (typeof window === 'undefined' || typeof document === 'undefined') return;
    if (document.getElementById(HOST_ID)) return;

    const host = document.createElement('div');
    host.id = HOST_ID;
    host.style.cssText = 'all: initial;';
    const root = host.attachShadow({ mode: 'open' });
    root.appendChild(buildStyle());
    const fab = buildFab();
    const infoCard = buildInfoCard();
    const pickerBar = buildPickerBar();
    const questionPanel = buildQuestionPanel();
    const highlight = buildHighlight();
    root.append(fab, infoCard, pickerBar, questionPanel, highlight);

    const mount = () => {
        if (!document.body) return false;
        document.body.appendChild(host);
        return true;
    };
    if (!mount()) {
        document.addEventListener('DOMContentLoaded', () => mount(), { once: true });
    }

    // ─── State machine ────────────────────────────────────────────────────
    type State = 'idle' | 'info' | 'picker' | 'question';
    let state: State = 'idle';
    let hoveredEl: Element | null = null;
    let lockedEl: Element | null = null;
    let statusPollTimer: number | undefined;

    const setState = (next: State) => {
        state = next;
        infoCard.style.display = next === 'info' ? 'flex' : 'none';
        pickerBar.style.display = next === 'picker' ? 'flex' : 'none';
        questionPanel.style.display = next === 'question' ? 'flex' : 'none';
        document.documentElement.style.cursor = next === 'picker' ? 'crosshair' : '';
        fab.dataset.state = next === 'picker' ? 'active' : 'idle';
        if (next !== 'picker' && next !== 'question') {
            highlight.style.display = 'none';
        }
        if (next === 'info') {
            renderInfo();
            if (!statusPollTimer) {
                statusPollTimer = window.setInterval(renderConnectionDot, 1000);
            }
        } else if (statusPollTimer) {
            window.clearInterval(statusPollTimer);
            statusPollTimer = undefined;
        }
    };

    // ─── Picker handlers ─────────────────────────────────────────────────
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
        if (state !== 'picker') return;
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
        if (state !== 'picker') return;
        if (ev.target === host || host.contains(ev.target as Node)) return;
        ev.preventDefault();
        ev.stopPropagation();
        ev.stopImmediatePropagation();
        if (!hoveredEl) return;
        lockedEl = hoveredEl;
        setHighlight(lockedEl);
        setState('question');
        const info = questionPanel.querySelector<HTMLElement>('[data-role=info]')!;
        info.textContent = describeElement(lockedEl);
        const textarea = questionPanel.querySelector<HTMLTextAreaElement>('textarea')!;
        textarea.value = '';
        setTimeout(() => textarea.focus(), 0);
    };

    const onKeyDown = (ev: KeyboardEvent) => {
        if (ev.key === 'Escape') {
            if (state === 'picker' || state === 'question') {
                lockedEl = null;
                setState('info');
            } else if (state === 'info') {
                setState('idle');
            }
            return;
        }
        // Cmd/Ctrl + Shift + H toggles the info card.
        const meta = ev.metaKey || ev.ctrlKey;
        if (meta && ev.shiftKey && (ev.key === 'h' || ev.key === 'H')) {
            ev.preventDefault();
            setState(state === 'idle' ? 'info' : 'idle');
        }
    };

    // ─── Info card rendering ─────────────────────────────────────────────
    const renderInfo = () => {
        const proj = infoCard.querySelector<HTMLElement>('[data-role=project]')!;
        const build = infoCard.querySelector<HTMLElement>('[data-role=build]')!;
        const session = infoCard.querySelector<HTMLElement>('[data-role=session]')!;
        const tab = infoCard.querySelector<HTMLElement>('[data-role=tab]')!;
        const url = infoCard.querySelector<HTMLElement>('[data-role=url]')!;
        proj.textContent = client.displayName ?? client.projectId;
        build.textContent = client.buildId ? abbr(client.buildId) : '—';
        build.title = client.buildId ?? 'No buildId — set HarnessaScript buildId prop in prod';
        session.textContent = abbr(client.sessionId);
        session.title = client.sessionId;
        tab.textContent = abbr(client.tabId);
        tab.title = client.tabId;
        url.textContent = shortenUrl(location.href);
        url.title = location.href;
        renderConnectionDot();
    };

    const renderConnectionDot = () => {
        const dot = infoCard.querySelector<HTMLElement>('[data-role=dot]')!;
        const label = infoCard.querySelector<HTMLElement>('[data-role=conn]')!;
        const state = client.getConnectionState();
        dot.dataset.state = state;
        label.textContent =
            state === 'open' ? 'connected' :
            state === 'connecting' ? 'connecting' : 'disconnected';
    };

    // ─── Copy buttons ────────────────────────────────────────────────────
    const copyText = async (text: string, feedback?: HTMLElement) => {
        try {
            await navigator.clipboard.writeText(text);
        } catch {
            // Fallback for non-secure contexts.
            const ta = document.createElement('textarea');
            ta.value = text;
            ta.style.position = 'fixed';
            ta.style.opacity = '0';
            document.body.appendChild(ta);
            ta.select();
            try { document.execCommand('copy'); } catch { /* swallow */ }
            ta.remove();
        }
        if (feedback) {
            const orig = feedback.textContent;
            feedback.dataset.copied = '1';
            feedback.textContent = '✓ copied';
            setTimeout(() => {
                delete feedback.dataset.copied;
                feedback.textContent = orig ?? '';
            }, 1200);
        }
    };

    const buildSnapshot = (): string => {
        const lines: string[] = [];
        lines.push(`### Harnessa-FE snapshot`);
        lines.push('');
        lines.push(`- project: \`${client.projectId}\`${client.displayName ? ` (${client.displayName})` : ''}`);
        if (client.buildId) lines.push(`- build: \`${client.buildId}\``);
        lines.push(`- session: \`${client.sessionId}\``);
        lines.push(`- tab: \`${client.tabId}\``);
        if (client.parentProjectId) lines.push(`- parent project: \`${client.parentProjectId}\``);
        lines.push(`- url: ${location.href}`);
        lines.push(`- time: ${new Date().toISOString()}`);
        lines.push(`- daemon: ${client.getConnectionState()}`);
        return lines.join('\n') + '\n';
    };

    // ─── Wire interactions ───────────────────────────────────────────────
    fab.addEventListener('click', () => {
        setState(state === 'idle' ? 'info' : 'idle');
    });

    infoCard.querySelector('[data-role=close]')!.addEventListener('click', () => setState('idle'));

    infoCard.querySelector('[data-role=report]')!.addEventListener('click', () => {
        setState('picker');
    });

    infoCard.querySelector('[data-role=copy-snapshot]')!.addEventListener('click', (ev) => {
        const btn = ev.currentTarget as HTMLElement;
        void copyText(buildSnapshot(), btn);
    });

    // Click on session / tab pill to copy that single value.
    for (const role of ['session', 'tab', 'build'] as const) {
        const pill = infoCard.querySelector<HTMLElement>(`[data-role=${role}]`)!;
        pill.addEventListener('click', () => {
            const value =
                role === 'session' ? client.sessionId :
                role === 'tab' ? client.tabId :
                client.buildId ?? '';
            if (!value) return;
            void copyText(value, pill);
        });
    }

    pickerBar.querySelector('[data-role=cancel]')!.addEventListener('click', () => setState('info'));

    questionPanel.querySelector('[data-role=cancel]')!.addEventListener('click', () => {
        lockedEl = null;
        setState('info');
    });

    questionPanel.querySelector('[data-role=submit]')!.addEventListener('click', () => {
        if (!lockedEl) return;
        const textarea = questionPanel.querySelector<HTMLTextAreaElement>('textarea')!;
        const question = textarea.value.trim();
        if (!question) {
            textarea.focus();
            return;
        }
        const payload = buildPayload(lockedEl, question);
        client.sendEvent(EVENT_NAME.TASK_SUBMIT, payload);
        flashFab(fab);
        lockedEl = null;
        setState('idle');
    });

    document.addEventListener('mousemove', onMouseMove, true);
    document.addEventListener('click', onClickCapture, true);
    document.addEventListener('keydown', onKeyDown, true);
}

// ─── DOM builders ────────────────────────────────────────────────────────

function buildStyle(): HTMLStyleElement {
    const style = document.createElement('style');
    style.textContent = `
        :host { all: initial; }
        .fab {
            position: fixed;
            right: 20px;
            bottom: 20px;
            width: 36px;
            height: 36px;
            border-radius: 50%;
            background: #111827;
            color: #fff;
            border: none;
            cursor: pointer;
            box-shadow: 0 4px 14px rgba(0, 0, 0, 0.25);
            font: 600 16px/1 ui-serif, Georgia, serif;
            display: flex;
            align-items: center;
            justify-content: center;
            z-index: 2147483646;
            transition: transform 0.15s ease, background 0.2s ease, box-shadow 0.2s ease;
            opacity: 0.85;
            letter-spacing: 0.01em;
        }
        .fab:hover { opacity: 1; transform: translateY(-1px); box-shadow: 0 6px 18px rgba(0,0,0,0.3); }
        .fab[data-state="active"] { background: #b91c1c; opacity: 1; }
        .fab[data-state="flash"] { background: #15803d; opacity: 1; }

        .info-card {
            position: fixed;
            right: 20px;
            bottom: 68px;
            width: 300px;
            background: #fff;
            color: #111;
            border: 1px solid #e5e7eb;
            border-radius: 12px;
            box-shadow: 0 16px 40px rgba(0, 0, 0, 0.18);
            padding: 14px;
            display: none;
            flex-direction: column;
            gap: 10px;
            z-index: 2147483646;
            font: 13px/1.4 system-ui, -apple-system, sans-serif;
        }
        .info-card .bar {
            display: flex;
            align-items: center;
            gap: 8px;
            padding-bottom: 10px;
            border-bottom: 1px solid #f3f4f6;
        }
        .info-card .bar .proj {
            font-weight: 600;
            flex: 1;
            min-width: 0;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
        }
        .info-card .dot {
            width: 8px;
            height: 8px;
            border-radius: 50%;
            background: #9ca3af;
            flex-shrink: 0;
        }
        .info-card .dot[data-state="open"] {
            background: #10b981;
            animation: pulse 2s ease-in-out infinite;
        }
        .info-card .dot[data-state="connecting"] {
            background: #f59e0b;
            animation: blink 0.6s ease-in-out infinite;
        }
        .info-card .conn { color: #6b7280; font-size: 11px; flex-shrink: 0; }
        .info-card .close-btn {
            background: none;
            border: none;
            color: #9ca3af;
            cursor: pointer;
            padding: 0;
            width: 18px;
            height: 18px;
            font-size: 16px;
            line-height: 1;
            flex-shrink: 0;
        }
        .info-card .close-btn:hover { color: #111; }

        .info-card .rows { display: flex; flex-direction: column; gap: 6px; }
        .info-card .row {
            display: flex;
            align-items: center;
            gap: 8px;
            font-size: 12px;
        }
        .info-card .row .key {
            color: #6b7280;
            width: 60px;
            flex-shrink: 0;
            font-size: 11px;
            text-transform: uppercase;
            letter-spacing: 0.04em;
        }
        .info-card .pill {
            font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
            font-size: 11px;
            background: #f3f4f6;
            border-radius: 5px;
            padding: 3px 7px;
            color: #374151;
            cursor: pointer;
            border: 1px solid transparent;
            transition: background 0.12s ease, border-color 0.12s ease;
            user-select: none;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
            max-width: 100%;
            min-width: 0;
        }
        .info-card .pill:hover { background: #e5e7eb; border-color: #d1d5db; }
        .info-card .pill[data-copied="1"] { background: #d1fae5; color: #065f46; }
        .info-card .pill.url {
            cursor: default;
            background: transparent;
            color: #6b7280;
            padding: 0;
        }
        .info-card .pill.url:hover { background: transparent; border-color: transparent; }

        .info-card .actions { display: flex; flex-direction: column; gap: 8px; margin-top: 4px; }
        .info-card .primary {
            background: #111827;
            color: #fff;
            border: none;
            border-radius: 8px;
            padding: 10px 12px;
            font: 600 13px/1.2 system-ui, sans-serif;
            cursor: pointer;
            text-align: left;
            display: flex;
            align-items: center;
            gap: 10px;
            transition: background 0.15s ease;
        }
        .info-card .primary:hover { background: #000; }
        .info-card .primary .icon { font-size: 16px; }
        .info-card .primary .label { flex: 1; }
        .info-card .primary .hint {
            font-size: 11px;
            color: #9ca3af;
            font-weight: 400;
        }

        .info-card .secondary {
            background: #fff;
            color: #374151;
            border: 1px solid #e5e7eb;
            border-radius: 8px;
            padding: 9px 12px;
            font: 500 12px/1.2 system-ui, sans-serif;
            cursor: pointer;
            display: flex;
            align-items: center;
            gap: 8px;
            transition: background 0.12s ease;
        }
        .info-card .secondary:hover { background: #f9fafb; }
        .info-card .secondary[data-copied="1"] { background: #d1fae5; color: #065f46; border-color: #6ee7b7; }

        .picker-bar {
            position: fixed;
            top: 12px;
            left: 50%;
            transform: translateX(-50%);
            background: #111827;
            color: #fff;
            border-radius: 8px;
            box-shadow: 0 6px 20px rgba(0, 0, 0, 0.3);
            padding: 8px 14px;
            display: none;
            align-items: center;
            gap: 14px;
            z-index: 2147483646;
            font: 13px/1 system-ui, sans-serif;
        }
        .picker-bar .label { display: flex; align-items: center; gap: 8px; }
        .picker-bar .hint { color: #9ca3af; font-size: 11px; }
        .picker-bar button {
            background: rgba(255, 255, 255, 0.1);
            color: #fff;
            border: none;
            border-radius: 5px;
            padding: 4px 10px;
            cursor: pointer;
            font: inherit;
        }
        .picker-bar button:hover { background: rgba(255, 255, 255, 0.18); }

        .highlight {
            position: absolute;
            pointer-events: none;
            border: 2px solid #2563eb;
            background: rgba(37, 99, 235, 0.1);
            border-radius: 3px;
            z-index: 2147483645;
            display: none;
            box-sizing: border-box;
        }

        .question {
            position: fixed;
            right: 20px;
            bottom: 68px;
            width: 320px;
            background: #fff;
            color: #111;
            border: 1px solid #e5e7eb;
            border-radius: 12px;
            box-shadow: 0 16px 40px rgba(0, 0, 0, 0.18);
            padding: 14px;
            display: none;
            flex-direction: column;
            gap: 10px;
            z-index: 2147483646;
            font: 13px/1.4 system-ui, sans-serif;
        }
        .question h3 { margin: 0; font-size: 13px; font-weight: 600; }
        .question .info {
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
        .question textarea {
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
        .question textarea:focus { border-color: #2563eb; }
        .question .row { display: flex; justify-content: flex-end; gap: 8px; }
        .question button {
            font: inherit;
            border-radius: 6px;
            padding: 6px 12px;
            cursor: pointer;
            border: 1px solid transparent;
        }
        .question .cancel { background: #fff; border-color: #d1d5db; color: #374151; }
        .question .submit { background: #111827; color: #fff; }
        .question .submit:hover { background: #000; }

        @keyframes pulse {
            0%, 100% { box-shadow: 0 0 0 0 rgba(16, 185, 129, 0.4); }
            50%      { box-shadow: 0 0 0 4px rgba(16, 185, 129, 0); }
        }
        @keyframes blink {
            0%, 100% { opacity: 1; }
            50%      { opacity: 0.4; }
        }
    `;
    return style;
}

function buildFab(): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.className = 'fab';
    btn.dataset.state = 'idle';
    btn.title = 'Harnessa-FE · click to open (Cmd+Shift+H)';
    btn.setAttribute('aria-label', 'Open Harnessa-FE panel');
    btn.textContent = 'H';
    return btn;
}

function buildInfoCard(): HTMLDivElement {
    const card = document.createElement('div');
    card.className = 'info-card';
    card.innerHTML = `
        <div class="bar">
            <span class="dot" data-role="dot"></span>
            <span class="proj" data-role="project"></span>
            <span class="conn" data-role="conn"></span>
            <button class="close-btn" data-role="close" title="Close (Esc)" type="button">×</button>
        </div>
        <div class="rows">
            <div class="row"><span class="key">build</span><span class="pill" data-role="build" title="Click to copy"></span></div>
            <div class="row"><span class="key">session</span><span class="pill" data-role="session" title="Click to copy"></span></div>
            <div class="row"><span class="key">tab</span><span class="pill" data-role="tab" title="Click to copy"></span></div>
            <div class="row"><span class="key">url</span><span class="pill url" data-role="url"></span></div>
        </div>
        <div class="actions">
            <button class="primary" data-role="report" type="button">
                <span class="icon">🎯</span>
                <span class="label">Report a problem</span>
                <span class="hint">Pick an element →</span>
            </button>
            <button class="secondary" data-role="copy-snapshot" type="button">📋 Copy snapshot</button>
        </div>
    `;
    return card;
}

function buildPickerBar(): HTMLDivElement {
    const bar = document.createElement('div');
    bar.className = 'picker-bar';
    bar.innerHTML = `
        <span class="label">🎯 Click an element to flag it</span>
        <span class="hint">esc to cancel</span>
        <button data-role="cancel" type="button">Cancel</button>
    `;
    return bar;
}

function buildQuestionPanel(): HTMLDivElement {
    const panel = document.createElement('div');
    panel.className = 'question';
    panel.innerHTML = `
        <h3>What's wrong with this element?</h3>
        <div class="info" data-role="info"></div>
        <textarea placeholder="Describe the problem, expected behavior, or what the agent should do…"></textarea>
        <div class="row">
            <button class="cancel" data-role="cancel" type="button">Cancel</button>
            <button class="submit" data-role="submit" type="button">Submit</button>
        </div>
    `;
    return panel;
}

function buildHighlight(): HTMLDivElement {
    const div = document.createElement('div');
    div.className = 'highlight';
    return div;
}

// ─── Element / payload helpers (unchanged from annotation.ts) ────────────

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
            rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
        },
    };
}

function truncate(s: string, n: number): string {
    return s.length <= n ? s : `${s.slice(0, n)}…`;
}

/**
 * Best-effort CSS path. Depth cap 12, id anchor short-circuits, ` >>> `
 * separates shadow-DOM boundaries.
 */
export function buildCssPath(el: Element): string {
    const segments: string[] = [];
    let current: string[] = [];
    let cur: Element | null = el;
    let depth = 0;
    const MAX_DEPTH = 12;

    while (cur && cur.nodeType === 1 && depth < MAX_DEPTH) {
        const node: Element = cur;
        const tag = node.tagName.toLowerCase();
        if (node.id) {
            current.unshift(`${tag}#${cssEscape(node.id)}`);
            break;
        }
        const parent: ParentNode | null = node.parentNode;
        if (parent instanceof ShadowRoot) {
            segments.unshift(current.join(' > '));
            current = [tag];
            cur = parent.host;
            depth++;
            continue;
        }
        const cls = node.classList?.[0];
        const seg = cls ? `${tag}.${cssEscape(cls)}` : tag;
        current.unshift(seg);
        const parentEl: Element | null = node.parentElement;
        if (!parentEl) break;
        const siblings: Element[] = Array.from(parentEl.children).filter(
            (c: Element) => c.tagName === node.tagName,
        );
        if (siblings.length > 1) {
            const idx = siblings.indexOf(node);
            current[0] = `${current[0]}:nth-of-type(${idx + 1})`;
        }
        cur = parentEl;
        depth++;
    }
    if (current.length > 0) segments.unshift(current.join(' > '));
    return segments.join(' >>> ');
}

function cssEscape(s: string): string {
    if (typeof CSS !== 'undefined' && CSS.escape) return CSS.escape(s);
    return s.replace(/[^a-zA-Z0-9_-]/g, '\\$&');
}

// ─── UI helpers ──────────────────────────────────────────────────────────

function abbr(id: string): string {
    if (id.length <= 12) return id;
    return id.slice(0, 8);
}

function shortenUrl(url: string): string {
    try {
        const u = new URL(url);
        const path = u.pathname + u.search;
        return path.length > 40 ? path.slice(0, 38) + '…' : path;
    } catch {
        return url;
    }
}

function flashFab(fab: HTMLElement): void {
    fab.dataset.state = 'flash';
    setTimeout(() => {
        fab.dataset.state = 'idle';
    }, 600);
}
