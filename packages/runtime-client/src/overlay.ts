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

import {
    EVENT_NAME,
    type ConsentDecision,
    type ConsentRequest,
    type TaskSubmitPayload,
    type TaskAttachment,
    type NetworkEntry,
} from '@harness-fe/protocol';
import { snapdom } from '@zumer/snapdom';
import { deriveDashboardUrl } from './dashboardUrl.js';
import { getCaptureStore } from './capture.js';
import { collectPageLoadSnapshot } from './snapshot.js';
import {
    getOverlayPlugins,
    subscribeOverlayPlugins,
    type OverlayPlugin,
    type OverlayPluginContext,
    type OverlayPluginLogs,
    type OverlayPluginGetLogsOptions,
} from './pluginRegistry.js';

/** Repo URL surfaced in the overlay footer. */
const GITHUB_URL = 'https://github.com/Morphicai/harness-fe';

const HOST_ID = '__harness_fe_overlay__';
const MAX_OUTER_HTML = 2048;

// Internal instrumentation attributes injected by our build plugin. Must be
// stripped before sending outerHTML to an agent — otherwise the agent treats
// them as business code and writes them back into the JSX source.
const INTERNAL_ATTR_RE = /\s+data-morphix-[\w-]*(="[^"]*")?/g;

function stripInternalAttrs(html: string): string {
    return html.replace(INTERNAL_ATTR_RE, '');
}

/**
 * Mark an element so common session-recording / RUM vendors skip it. Our
 * overlay must not pollute the host app's analytics or replay data, and must
 * not leak our session/visitor ids to third-party servers.
 */
function hideFromThirdParties(el: Element): void {
    // rrweb / PostHog
    el.setAttribute('data-rr-block', '');
    el.setAttribute('data-rr-ignore', '');
    el.setAttribute('data-rr-mask', '');
    el.classList.add('ph-no-capture');
    // Sentry session replay
    el.setAttribute('data-sentry-block', '');
    el.setAttribute('data-sentry-ignore', '');
    el.setAttribute('data-sentry-mask', '');
    // Datadog RUM
    el.setAttribute('data-dd-privacy', 'hidden');
    // FullStory
    el.setAttribute('data-fs-exclude', '');
    // LogRocket
    el.setAttribute('data-lr-exclude', '');
    // Hotjar
    el.setAttribute('data-hj-suppress', '');
    // Smartlook
    el.setAttribute('data-recording-disable', '');
    // Microsoft Clarity
    el.setAttribute('data-clarity-mask', 'true');
    // Heap
    el.setAttribute('data-heap-redact-text', '');
}

export interface OverlayClient {
    readonly projectId: string;
    readonly buildId?: string;
    readonly displayName?: string;
    readonly tabId: string;
    readonly sessionId: string;
    readonly visitorId?: string;
    readonly userId?: string;
    readonly parentProjectId?: string;
    /**
     * WebSocket URL the runtime connects to. Used by the overlay to derive
     * the daemon's dashboard URL ("Open dashboard" button). Optional — if
     * absent, the button hides instead of pointing at the wrong host.
     */
    readonly mcpUrl?: string;
    getConnectionState(): 'connecting' | 'open' | 'closed';
    sendEvent(name: string, payload: unknown): void;
    /**
     * RPC channel to the daemon. Used to fetch and mutate the visitor's own
     * tasks. Resolves with `result`, rejects with the remote error message.
     */
    query?<TResult = unknown>(method: string, args?: unknown): Promise<TResult>;
    /**
     * Register the browser-consent prompter (4.0 · P2). The client calls this
     * to ask the user before running a control command. Optional so embedders
     * with a non-RuntimeClient overlay client still type-check.
     */
    setConsentPrompter?(fn: (req: ConsentRequest) => Promise<ConsentDecision>): void;
}

/** Subset of @harness-fe/protocol Task that the overlay renders. */
interface TaskSummary {
    id: string;
    status: 'pending' | 'claimed' | 'resolved';
    question: string;
    url: string;
    selector: { loc?: string; comp?: string; css?: string };
    createdAt: number;
    updatedAt?: number;
    claimedAt?: number;
    resolvedAt?: number;
    note?: string;
    /** Attachment pointers or (for fresh tasks.mine) first-attachment inline base64. */
    attachments?: Array<{ id: string; kind: string; width: number; height: number; path?: string; data?: string }>;
}

export function installOverlay(client: OverlayClient): void {
    if (typeof window === 'undefined' || typeof document === 'undefined') return;
    if (document.getElementById(HOST_ID)) return;

    const host = document.createElement('div');
    host.id = HOST_ID;
    host.style.cssText = 'all: initial;';
    hideFromThirdParties(host);
    const root = host.attachShadow({ mode: 'open' });
    root.appendChild(buildStyle());
    const fab = buildFab();
    const infoCard = buildInfoCard();
    const reportsCard = buildReportsCard();
    const pickerBar = buildPickerBar();
    const annotateModal = buildAnnotateModal();
    const questionPanel = buildQuestionPanel();
    const consentPanel = buildConsentPanel();
    const highlight = buildHighlight();
    root.append(fab, infoCard, reportsCard, pickerBar, annotateModal, questionPanel, consentPanel, highlight);

    const mount = () => {
        if (!document.body) return false;
        document.body.appendChild(host);
        return true;
    };
    if (!mount()) {
        document.addEventListener('DOMContentLoaded', () => mount(), { once: true });
    }

    // ─── FAB position (drag-and-drop + persistence) ──────────────────────
    //
    // The FAB lives in a fixed position the user can drag anywhere on
    // screen, with the location stashed in localStorage so it survives
    // reloads. Follower cards (info / reports / question) anchor relative
    // to the FAB and flip side based on available space.
    const FAB_SIZE = 40;
    const FAB_MARGIN = 16;
    const FAB_POS_KEY = '__harness_fe_fab_pos__';
    const DRAG_THRESHOLD = 5; // px before we treat a pointerdown as a drag

    interface FabPos { x: number; y: number }
    const readPersistedPos = (): FabPos | undefined => {
        try {
            const raw = window.localStorage?.getItem(FAB_POS_KEY);
            if (!raw) return undefined;
            const parsed = JSON.parse(raw) as { x?: unknown; y?: unknown };
            if (typeof parsed.x === 'number' && typeof parsed.y === 'number') {
                return { x: parsed.x, y: parsed.y };
            }
        } catch {
            /* swallow — storage unavailable, missing, or malformed */
        }
        return undefined;
    };
    const persistPos = (pos: FabPos): void => {
        try {
            window.localStorage?.setItem(FAB_POS_KEY, JSON.stringify(pos));
        } catch {
            /* swallow — quota / sandboxed iframe / etc. */
        }
    };
    const clampPos = (pos: FabPos): FabPos => {
        const w = window.innerWidth || 1024;
        const h = window.innerHeight || 768;
        return {
            x: Math.max(FAB_MARGIN, Math.min(w - FAB_SIZE - FAB_MARGIN, pos.x)),
            y: Math.max(FAB_MARGIN, Math.min(h - FAB_SIZE - FAB_MARGIN, pos.y)),
        };
    };
    const defaultPos = (): FabPos => {
        const w = window.innerWidth || 1024;
        const h = window.innerHeight || 768;
        return { x: w - FAB_SIZE - FAB_MARGIN, y: h - FAB_SIZE - FAB_MARGIN };
    };

    let fabPos: FabPos = clampPos(readPersistedPos() ?? defaultPos());

    const applyFabPosition = (): void => {
        fab.style.left = `${fabPos.x}px`;
        fab.style.top = `${fabPos.y}px`;
        fab.style.right = 'auto';
        fab.style.bottom = 'auto';
    };

    /**
     * Position the visible follower card anchored to the current FAB
     * location. Cards prefer to sit above the FAB; flip below when there
     * isn't enough room above. Horizontal alignment mirrors which half of
     * the viewport the FAB lives in (so a FAB in the left half gets cards
     * extending right, and vice-versa).
     */
    const repositionCards = (): void => {
        const rect = fab.getBoundingClientRect();
        const halfW = (window.innerWidth || 1024) / 2;
        const winH = window.innerHeight || 768;
        const gap = 12;

        const cards: Array<{ el: HTMLElement; estimatedHeight: number }> = [
            { el: infoCard, estimatedHeight: 280 },
            { el: reportsCard, estimatedHeight: 460 },
            { el: questionPanel, estimatedHeight: 320 },
        ];

        for (const { el, estimatedHeight } of cards) {
            if (el.style.display === 'none') continue;
            const cardW = el.offsetWidth || 320;
            const cardH = el.offsetHeight || estimatedHeight;
            const onLeftHalf = rect.left + rect.width / 2 < halfW;
            // Horizontal: align the card's left or right edge to the FAB's
            let left = onLeftHalf ? rect.left : rect.right - cardW;
            left = Math.max(8, Math.min((window.innerWidth || 1024) - cardW - 8, left));
            // Vertical: prefer above the FAB; flip below when constrained.
            let top: number;
            if (rect.top - gap - cardH >= 8) {
                top = rect.top - gap - cardH;
            } else if (rect.bottom + gap + cardH <= winH - 8) {
                top = rect.bottom + gap;
            } else {
                // Both directions constrained: center vertically.
                top = Math.max(8, Math.min(winH - cardH - 8, rect.top - cardH / 2));
            }
            el.style.left = `${left}px`;
            el.style.top = `${top}px`;
            el.style.right = 'auto';
            el.style.bottom = 'auto';
        }
    };

    applyFabPosition();

    // ─── Drag handlers ───────────────────────────────────────────────────
    let dragOriginPos: FabPos | null = null;
    let pointerDownAt: { x: number; y: number } | null = null;
    let dragging = false;
    let suppressNextClick = false;

    const onFabPointerDown = (ev: PointerEvent) => {
        if (ev.button !== 0) return;
        try { fab.setPointerCapture(ev.pointerId); } catch { /* swallow */ }
        dragOriginPos = { x: fabPos.x, y: fabPos.y };
        pointerDownAt = { x: ev.clientX, y: ev.clientY };
        dragging = false;
    };

    const onFabPointerMove = (ev: PointerEvent) => {
        if (!pointerDownAt || !dragOriginPos) return;
        const dx = ev.clientX - pointerDownAt.x;
        const dy = ev.clientY - pointerDownAt.y;
        if (!dragging && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
        dragging = true;
        suppressNextClick = true;
        fab.dataset.dragging = '1';
        fabPos = clampPos({ x: dragOriginPos.x + dx, y: dragOriginPos.y + dy });
        applyFabPosition();
        repositionCards();
    };

    const onFabPointerUp = (ev: PointerEvent) => {
        try { fab.releasePointerCapture(ev.pointerId); } catch { /* swallow */ }
        const wasDragging = dragging;
        dragOriginPos = null;
        pointerDownAt = null;
        dragging = false;
        delete fab.dataset.dragging;
        if (wasDragging) persistPos(fabPos);
    };

    fab.addEventListener('pointerdown', onFabPointerDown);
    fab.addEventListener('pointermove', onFabPointerMove);
    fab.addEventListener('pointerup', onFabPointerUp);
    fab.addEventListener('pointercancel', onFabPointerUp);

    // Keep things on-screen when the viewport changes (window resize,
    // dev tools open, mobile keyboard, …).
    const onWindowResize = () => {
        fabPos = clampPos(fabPos);
        applyFabPosition();
        repositionCards();
    };
    window.addEventListener('resize', onWindowResize);

    // ─── State machine ────────────────────────────────────────────────────
    type State = 'idle' | 'info' | 'reports' | 'picker' | 'annotate' | 'question' | 'consent';
    let state: State = 'idle';
    let hoveredEl: Element | null = null;
    let lockedEl: Element | null = null;
    let statusPollTimer: number | undefined;
    /** Flattened PNG from the annotate step; null if user skipped. */
    let pendingAttachment: TaskAttachment | null = null;
    /** Set while the picker is collecting an element for a `requiresElement` plugin. */
    let pluginAwaitingElement: OverlayPlugin | null = null;

    const setState = (next: State) => {
        state = next;
        infoCard.style.display = next === 'info' ? 'flex' : 'none';
        reportsCard.style.display = next === 'reports' ? 'flex' : 'none';
        pickerBar.style.display = next === 'picker' ? 'flex' : 'none';
        annotateModal.style.display = next === 'annotate' ? 'flex' : 'none';
        questionPanel.style.display = next === 'question' ? 'flex' : 'none';
        consentPanel.style.display = next === 'consent' ? 'flex' : 'none';
        document.documentElement.style.cursor = next === 'picker' ? 'crosshair' : '';
        fab.dataset.state = (next === 'picker' || next === 'annotate') ? 'active' : 'idle';
        if (next !== 'picker' && next !== 'question' && next !== 'annotate') {
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
        if (next === 'reports') {
            void refreshReports();
        }
        if (next === 'annotate' && lockedEl) {
            void enterAnnotate(lockedEl);
        }
        // Anchor the just-revealed follower card relative to the FAB. Wait
        // one frame so `display: flex` has applied and offsetWidth/Height
        // are real (otherwise the first render uses fallback estimates).
        if (next === 'info' || next === 'reports' || next === 'question') {
            requestAnimationFrame(() => repositionCards());
        }
    };

    // ─── Browser consent prompter (4.0 · P2) ─────────────────────────────
    // The client calls this before running a control command when the daemon
    // enabled consent. We show a modal and resolve with the user's choice.
    const consentCmdEl = consentPanel.querySelector('[data-role="consent-cmd"]') as HTMLElement;
    const consentAllowOnce = consentPanel.querySelector('[data-role="consent-once"]') as HTMLButtonElement;
    const consentAllowSession = consentPanel.querySelector('[data-role="consent-session"]') as HTMLButtonElement;
    const consentDeny = consentPanel.querySelector('[data-role="consent-deny"]') as HTMLButtonElement;
    let consentChain: Promise<unknown> = Promise.resolve();

    const promptConsent = (req: ConsentRequest): Promise<ConsentDecision> =>
        new Promise<ConsentDecision>((resolve) => {
            consentCmdEl.textContent = formatConsentCommand(req);
            // page.evaluate (alwaysConfirm) can never be granted session-wide.
            consentAllowSession.style.display = req.alwaysConfirm ? 'none' : '';
            setState('consent');
            const finish = (decision: ConsentDecision) => {
                consentAllowOnce.removeEventListener('click', onOnce);
                consentAllowSession.removeEventListener('click', onSession);
                consentDeny.removeEventListener('click', onDeny);
                setState('idle');
                resolve(decision);
            };
            const onOnce = () => finish('once');
            const onSession = () => finish('session');
            const onDeny = () => finish('deny');
            consentAllowOnce.addEventListener('click', onOnce);
            consentAllowSession.addEventListener('click', onSession);
            consentDeny.addEventListener('click', onDeny);
        });

    // Serialize prompts so a burst of control commands queues one dialog at a time.
    const showConsentPrompt = (req: ConsentRequest): Promise<ConsentDecision> => {
        const result = consentChain.then(() => promptConsent(req));
        consentChain = result.catch(() => undefined);
        return result;
    };
    client.setConsentPrompter?.(showConsentPrompt);

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
        // A plugin requested the element — hand it straight to its onClick and
        // skip the report/question flow entirely.
        if (pluginAwaitingElement) {
            const plugin = pluginAwaitingElement;
            pluginAwaitingElement = null;
            const el = lockedEl;
            lockedEl = null;
            setState('idle');
            void invokePlugin(plugin, el);
            return;
        }
        // Go straight to the question step. Screenshots are now opt-in via
        // the "Add screenshot" button inside the question panel — users
        // shouldn't have to draw on every report.
        pendingAttachment = null;
        const info = questionPanel.querySelector<HTMLElement>('[data-role=info]')!;
        info.textContent = describeElement(lockedEl);
        const textarea = questionPanel.querySelector<HTMLTextAreaElement>('textarea')!;
        textarea.value = '';
        renderAttachmentPreview();
        setState('question');
        setTimeout(() => textarea.focus(), 0);
    };

    const onKeyDown = (ev: KeyboardEvent) => {
        if (ev.key === 'Escape') {
            if (state === 'annotate') {
                // Esc in annotate: keep any prior attachment, just discard the
                // in-progress strokes and return to the question step where
                // the user came from. Re-entering annotate later will start
                // a fresh canvas.
                resetAnnotateStrokes();
                setState('question');
            } else if (state === 'picker' || state === 'question') {
                lockedEl = null;
                pendingAttachment = null;
                pluginAwaitingElement = null;
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
        build.title = client.buildId ?? 'No buildId — set HarnessScript buildId prop in prod';
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
        lines.push(`### Harness-FE snapshot`);
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

    // ─── Plugin support ──────────────────────────────────────────────────
    const dashboardUrl = client.mcpUrl
        ? deriveDashboardUrl({ mcpUrl: client.mcpUrl, sessionId: client.sessionId })
        : undefined;

    /** Brief transient toast anchored near the FAB. */
    const showToast = (message: string, kind: 'ok' | 'error' = 'ok'): void => {
        const el = document.createElement('div');
        el.className = 'hfe-toast';
        el.dataset.kind = kind;
        el.textContent = message;
        root.appendChild(el);
        requestAnimationFrame(() => { el.dataset.show = '1'; });
        setTimeout(() => {
            el.dataset.show = '';
            setTimeout(() => el.remove(), 250);
        }, 2400);
    };

    const buildPluginContext = (selectedEl?: Element): OverlayPluginContext => {
        const selectedElement = selectedEl
            ? {
                  el: selectedEl,
                  selector: {
                      comp: selectedEl.getAttribute('data-morphix-comp') ?? undefined,
                      loc: selectedEl.getAttribute('data-morphix-loc') ?? undefined,
                      css: buildCssPath(selectedEl),
                  },
                  outerHTML: truncate(stripInternalAttrs(selectedEl.outerHTML), MAX_OUTER_HTML),
                  rect: (() => {
                      const r = selectedEl.getBoundingClientRect();
                      return { x: r.x, y: r.y, width: r.width, height: r.height };
                  })(),
              }
            : undefined;
        return {
            projectId: client.projectId,
            displayName: client.displayName,
            buildId: client.buildId,
            parentProjectId: client.parentProjectId,
            sessionId: client.sessionId,
            tabId: client.tabId,
            visitorId: client.visitorId,
            userId: client.userId,
            url: location.href,
            connectionState: client.getConnectionState(),
            dashboardUrl,
            selectedElement,
            snapshotMarkdown: buildSnapshot,
            snapshot: () => collectPageLoadSnapshot(client.sessionId),
            getLogs: (opts) => collectLogs(opts),
            captureScreenshot: (el) => captureElementPng(el ?? selectedEl ?? document.body),
            query: client.query ? client.query.bind(client) : undefined,
            copyToClipboard: (text) => copyText(text),
            toast: showToast,
        };
    };

    const invokePlugin = async (plugin: OverlayPlugin, selectedEl?: Element): Promise<void> => {
        try {
            await plugin.onClick(buildPluginContext(selectedEl));
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            showToast(`${plugin.label}: ${msg}`, 'error');
        }
    };

    /** (Re)render the plugin button group in the info card. */
    const renderPluginButtons = (): void => {
        const slot = infoCard.querySelector<HTMLElement>('[data-role=plugin-actions]');
        if (!slot) return;
        const list = getOverlayPlugins();
        slot.innerHTML = '';
        slot.style.display = list.length ? '' : 'none';
        for (const plugin of list) {
            const btn = document.createElement('button');
            btn.className = 'secondary';
            btn.type = 'button';
            btn.dataset.pluginId = plugin.id;
            btn.textContent = `${plugin.icon ? plugin.icon + ' ' : ''}${plugin.label}`;
            btn.addEventListener('click', () => {
                if (plugin.requiresElement) {
                    pluginAwaitingElement = plugin;
                    setState('picker');
                } else {
                    setState('idle');
                    void invokePlugin(plugin);
                }
            });
            slot.appendChild(btn);
        }
    };

    renderPluginButtons();
    const unsubscribePlugins = subscribeOverlayPlugins(() => {
        // Only the info card shows plugin buttons; re-render whenever the set changes.
        renderPluginButtons();
    });
    void unsubscribePlugins; // overlay lives for the page lifetime; no teardown path

    // ─── Reports rendering ───────────────────────────────────────────────
    let editingTaskId: string | null = null;
    let deleteConfirmId: string | null = null;
    let deleteConfirmTimer: number | undefined;

    const refreshReports = async (): Promise<void> => {
        const list = reportsCard.querySelector<HTMLElement>('[data-role=list]')!;
        const countEl = reportsCard.querySelector<HTMLElement>('[data-role=count]')!;
        list.innerHTML = '<div class="loading">Loading…</div>';
        countEl.textContent = '';
        if (!client.query) {
            list.innerHTML = `<div class="empty">RPC channel not available — daemon may be too old.</div>`;
            return;
        }
        try {
            const res = await client.query<{ tasks: TaskSummary[] }>('tasks.mine', { limit: 50 });
            const tasks = Array.isArray(res?.tasks) ? res.tasks : [];
            countEl.textContent = tasks.length === 0 ? '' : `(${tasks.length})`;
            renderTasks(list, tasks);
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            list.innerHTML = `<div class="empty error">Failed to load: ${escapeHtml(message)}</div>`;
        }
    };

    const renderTasks = (list: HTMLElement, tasks: TaskSummary[]): void => {
        if (tasks.length === 0) {
            list.innerHTML = `<div class="empty">No reports yet — click "Report a problem" to file one.</div>`;
            return;
        }
        const html = tasks.map((t) => renderTaskRow(t)).join('');
        list.innerHTML = html;
        // Delegate clicks
        list.querySelectorAll<HTMLElement>('[data-action]').forEach((btn) => {
            btn.addEventListener('click', (ev) => {
                ev.stopPropagation();
                const action = btn.dataset.action!;
                const id = btn.dataset.id!;
                const task = tasks.find((x) => x.id === id);
                if (!task) return;
                handleTaskAction(action, task);
            });
        });
    };

    const renderTaskRow = (t: TaskSummary): string => {
        const statusIcon = t.status === 'pending' ? '⏳' : t.status === 'claimed' ? '⊕' : '✓';
        const ago = formatAgo(t.createdAt);
        const fileBit = t.selector.loc ?? t.selector.comp ?? '';
        const url = shortenUrl(t.url);
        const isEditing = editingTaskId === t.id;
        const isConfirmingDelete = deleteConfirmId === t.id;
        const editBody = isEditing
            ? `<textarea class="edit-area" data-action="edit-input" data-id="${escapeAttr(t.id)}">${escapeHtml(t.question)}</textarea>
               <div class="row-actions">
                 <button class="rl-btn" data-action="edit-save" data-id="${escapeAttr(t.id)}">Save</button>
                 <button class="rl-btn ghost" data-action="edit-cancel" data-id="${escapeAttr(t.id)}">Cancel</button>
               </div>`
            : `<div class="q">${escapeHtml(t.question)}</div>
               ${t.note ? `<div class="note">↳ ${escapeHtml(t.note)}</div>` : ''}
               ${t.attachments?.[0]?.data ? `<img class="task-thumb" data-action="thumb" data-id="${escapeAttr(t.id)}" src="data:image/png;base64,${escapeAttr(t.attachments[0].data)}" alt="screenshot" title="Click to enlarge" />` : ''}
               <div class="meta">${escapeHtml(fileBit)}${fileBit && url ? ' · ' : ''}${escapeHtml(url)}</div>
               <div class="row-actions">
                 ${t.status !== 'resolved' ? `<button class="rl-btn" data-action="edit" data-id="${escapeAttr(t.id)}">edit</button>` : ''}
                 <button class="rl-btn" data-action="copy" data-id="${escapeAttr(t.id)}">copy</button>
                 ${isConfirmingDelete
                     ? `<button class="rl-btn danger" data-action="confirm-delete" data-id="${escapeAttr(t.id)}">confirm ×</button>`
                     : `<button class="rl-btn ghost" data-action="delete" data-id="${escapeAttr(t.id)}">×</button>`}
               </div>`;
        return `
            <div class="task-row" data-status="${escapeAttr(t.status)}">
                <div class="status">${statusIcon} <span class="ago">${escapeHtml(ago)}</span></div>
                ${editBody}
            </div>
        `;
    };

    const handleTaskAction = async (action: string, task: TaskSummary): Promise<void> => {
        const list = reportsCard.querySelector<HTMLElement>('[data-role=list]')!;
        switch (action) {
            case 'edit':
                editingTaskId = task.id;
                deleteConfirmId = null;
                await refreshReports();
                return;
            case 'edit-cancel':
                editingTaskId = null;
                await refreshReports();
                return;
            case 'edit-save': {
                const ta = list.querySelector<HTMLTextAreaElement>(`textarea[data-id="${task.id}"]`);
                const newQuestion = ta?.value.trim() ?? '';
                if (!newQuestion) { ta?.focus(); return; }
                if (!client.query) return;
                try {
                    await client.query('tasks.update', { id: task.id, question: newQuestion });
                    editingTaskId = null;
                    await refreshReports();
                } catch (err) {
                    console.warn('[harness-fe] tasks.update failed:', err);
                }
                return;
            }
            case 'thumb': {
                const att = task.attachments?.[0];
                if (att?.data) {
                    showLightbox(root, `data:image/png;base64,${att.data}`);
                }
                return;
            }
            case 'copy':
                void copyText(buildTaskSnapshot(task));
                return;
            case 'delete':
                deleteConfirmId = task.id;
                editingTaskId = null;
                if (deleteConfirmTimer) window.clearTimeout(deleteConfirmTimer);
                deleteConfirmTimer = window.setTimeout(() => {
                    deleteConfirmId = null;
                    void refreshReports();
                }, 3000);
                await refreshReports();
                return;
            case 'confirm-delete':
                if (!client.query) return;
                try {
                    await client.query('tasks.delete', { id: task.id });
                    deleteConfirmId = null;
                    if (deleteConfirmTimer) window.clearTimeout(deleteConfirmTimer);
                    await refreshReports();
                } catch (err) {
                    console.warn('[harness-fe] tasks.delete failed:', err);
                }
                return;
        }
    };

    const buildTaskSnapshot = (t: TaskSummary): string => {
        const lines: string[] = [];
        lines.push(`### Harness-FE task ${t.id} (${t.status})`);
        lines.push('');
        lines.push(`- project: \`${client.projectId}\`${client.displayName ? ` (${client.displayName})` : ''}`);
        if (client.buildId) lines.push(`- build: \`${client.buildId}\``);
        if (client.visitorId) lines.push(`- visitor: \`${client.visitorId}\``);
        if (t.selector.loc) lines.push(`- source: \`${t.selector.loc}\``);
        if (t.selector.comp) lines.push(`- component: \`${t.selector.comp}\``);
        lines.push(`- url: ${t.url}`);
        lines.push(`- submitted: ${new Date(t.createdAt).toISOString()}`);
        if (t.attachments && t.attachments.length > 0) {
            for (const att of t.attachments) {
                const dims = att.width && att.height ? ` (${att.width}×${att.height})` : '';
                const pathStr = att.path ?? `task-attachments/${t.id}/${att.id}.png`;
                lines.push(`- attachment: ${pathStr}${dims}`);
            }
        }
        lines.push('');
        lines.push(`**question:** ${t.question}`);
        if (t.note) {
            lines.push('');
            lines.push(`**agent note:** ${t.note}`);
        }
        lines.push('');
        lines.push('Agent commands:');
        lines.push('```');
        lines.push(`mcp call tasks.claim { "taskId": "${t.id}" }`);
        if (t.attachments?.[0]) {
            lines.push(`mcp call tasks.get_attachment { "taskId": "${t.id}", "attachmentId": "${t.attachments[0].id}" }`);
        }
        if (t.selector.loc) lines.push(`mcp call project.where_is { "loc": "${t.selector.loc}" }`);
        lines.push('```');
        return lines.join('\n') + '\n';
    };

    /** Show a full-screen lightbox in the shadow DOM. Click anywhere to close. */
    const showLightbox = (shadowRoot: ShadowRoot, src: string): void => {
        const existing = shadowRoot.querySelector('.thumb-lightbox');
        if (existing) { existing.remove(); return; }
        const lb = document.createElement('div');
        lb.className = 'thumb-lightbox';
        const img = document.createElement('img');
        img.src = src;
        img.alt = 'Screenshot annotation';
        lb.appendChild(img);
        lb.addEventListener('click', () => lb.remove());
        shadowRoot.appendChild(lb);
    };

    // ─── Wire interactions ───────────────────────────────────────────────
    fab.addEventListener('click', (ev) => {
        // Suppress the synthetic click that follows a drag — the user
        // dragged the FAB, they didn't intend to open the info card.
        if (suppressNextClick) {
            suppressNextClick = false;
            ev.preventDefault();
            ev.stopPropagation();
            return;
        }
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

    infoCard.querySelector('[data-role=view-reports]')!.addEventListener('click', () => {
        setState('reports');
    });

    // "Open dashboard" — derive the daemon's dashboard URL from mcpUrl and
    // pop it in a new tab, deep-linked to this session. Show the button
    // only when we actually know the daemon address (mcpUrl was supplied by
    // the plugin / runtime config).
    {
        const dashboardBtn = infoCard.querySelector<HTMLButtonElement>('[data-role=open-dashboard]')!;
        if (dashboardUrl) {
            dashboardBtn.style.display = '';
            dashboardBtn.title = `Open ${dashboardUrl} in a new tab`;
            dashboardBtn.addEventListener('click', () => {
                try {
                    window.open(dashboardUrl, '_blank', 'noopener,noreferrer');
                } catch {
                    // Popup blocked or sandboxed iframe — copy as fallback so
                    // the user can paste it into the address bar manually.
                    void copyText(dashboardUrl, dashboardBtn);
                }
            });
        }
    }

    // GitHub promo link — anchor navigates natively; this fallback covers
    // sandboxed iframes / popup blockers by copying the URL instead.
    infoCard.querySelector<HTMLAnchorElement>('[data-role=github]')!.addEventListener('click', (ev) => {
        try {
            const opened = window.open(GITHUB_URL, '_blank', 'noopener,noreferrer');
            if (opened) ev.preventDefault();
        } catch {
            ev.preventDefault();
            void copyText(GITHUB_URL, ev.currentTarget as HTMLElement);
        }
    });

    reportsCard.querySelector('[data-role=back]')!.addEventListener('click', () => setState('info'));
    reportsCard.querySelector('[data-role=close]')!.addEventListener('click', () => setState('idle'));
    reportsCard.querySelector('[data-role=refresh]')!.addEventListener('click', () => void refreshReports());

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

    pickerBar.querySelector('[data-role=cancel]')!.addEventListener('click', () => {
        lockedEl = null;
        pluginAwaitingElement = null;
        setState('info');
    });

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
        const payload = buildPayload(lockedEl, question, pendingAttachment ?? undefined);
        client.sendEvent(EVENT_NAME.TASK_SUBMIT, payload);
        flashFab(fab);
        lockedEl = null;
        pendingAttachment = null;
        setState('idle');
    });

    // ─── Question panel ↔ Annotate modal wiring ──────────────────────────

    // Re-render the attachment preview block based on `pendingAttachment`.
    const renderAttachmentPreview = (): void => {
        const area = questionPanel.querySelector<HTMLElement>('[data-role=attach-area]')!;
        const addBtn = area.querySelector<HTMLButtonElement>('[data-role=add-shot]')!;
        const preview = area.querySelector<HTMLElement>('[data-role=thumb-preview]')!;
        const img = preview.querySelector<HTMLImageElement>('[data-role=thumb-img]')!;
        const dims = preview.querySelector<HTMLElement>('[data-role=thumb-dims]')!;
        if (pendingAttachment && pendingAttachment.data) {
            addBtn.style.display = 'none';
            preview.style.display = 'flex';
            img.src = `data:image/png;base64,${pendingAttachment.data}`;
            dims.textContent = `${pendingAttachment.width}×${pendingAttachment.height}`;
        } else {
            addBtn.style.display = 'inline-flex';
            preview.style.display = 'none';
            img.src = '';
        }
    };

    questionPanel.querySelector('[data-role=add-shot]')!.addEventListener('click', () => {
        // Launch the annotate modal. lockedEl is still set from picker.
        if (!lockedEl) return;
        setState('annotate');
    });

    questionPanel.querySelector('[data-role=thumb-edit]')!.addEventListener('click', () => {
        // Discard current PNG; re-enter annotate to recapture.
        pendingAttachment = null;
        resetAnnotateStrokes();
        renderAttachmentPreview();
        if (!lockedEl) return;
        setState('annotate');
    });

    questionPanel.querySelector('[data-role=thumb-remove]')!.addEventListener('click', () => {
        pendingAttachment = null;
        renderAttachmentPreview();
    });

    annotateModal.querySelector('[data-role=annotate-cancel]')!.addEventListener('click', () => {
        // Cancel the in-progress annotation; keep whatever pendingAttachment
        // existed before this annotate cycle (typically null).
        resetAnnotateStrokes();
        setState('question');
    });

    annotateModal.querySelector('[data-role=annotate-done]')!.addEventListener('click', () => {
        void finalizeAnnotation().then((attachment) => {
            if (attachment) pendingAttachment = attachment;
            renderAttachmentPreview();
            setState('question');
            const textarea = questionPanel.querySelector<HTMLTextAreaElement>('textarea')!;
            // Don't clobber user's typed question. Focus the textarea so they
            // can keep writing.
            setTimeout(() => textarea.focus(), 0);
        });
    });

    document.addEventListener('mousemove', onMouseMove, true);
    document.addEventListener('click', onClickCapture, true);
    document.addEventListener('keydown', onKeyDown, true);
}

// ─── Annotate engine ─────────────────────────────────────────────────────────
//
// Module-level state for the annotation canvas. The annotate flow is entered
// once per task report; module scope is fine because installOverlay is called
// once per page.

type AnnotateTool = 'arrow' | 'text';
type AnnotateColor = 'red' | 'blue' | 'yellow' | 'green' | 'black';

const ANNOTATE_COLORS: Record<AnnotateColor, string> = {
    red: '#ef4444',
    blue: '#3b82f6',
    yellow: '#eab308',
    green: '#22c55e',
    black: '#111827',
};

interface ArrowStroke {
    kind: 'arrow';
    color: string;
    x1: number; y1: number;
    x2: number; y2: number;
}

interface TextStroke {
    kind: 'text';
    color: string;
    x: number; y: number;
    text: string;
}

type Stroke = ArrowStroke | TextStroke;

let _annotateCanvas: HTMLCanvasElement | null = null;
let _annotateCtx: CanvasRenderingContext2D | null = null;
let _annotateBackground: HTMLCanvasElement | null = null;
let _annotateStrokes: Stroke[] = [];
let _annotateTool: AnnotateTool = 'arrow';
let _annotateColor: AnnotateColor = 'red';

function resetAnnotateStrokes(): void {
    _annotateStrokes = [];
    _annotateTool = 'arrow';
    _annotateColor = 'red';
    _annotateCanvas = null;
    _annotateCtx = null;
    _annotateBackground = null;
}

function drawArrow(
    ctx: CanvasRenderingContext2D,
    x1: number, y1: number,
    x2: number, y2: number,
    color: string,
): void {
    const headLen = 14;
    const angle = Math.atan2(y2 - y1, x2 - x1);
    ctx.save();
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = 2.5;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
    // Arrowhead triangle at endpoint
    ctx.beginPath();
    ctx.moveTo(x2, y2);
    ctx.lineTo(
        x2 - headLen * Math.cos(angle - Math.PI / 6),
        y2 - headLen * Math.sin(angle - Math.PI / 6),
    );
    ctx.lineTo(
        x2 - headLen * Math.cos(angle + Math.PI / 6),
        y2 - headLen * Math.sin(angle + Math.PI / 6),
    );
    ctx.closePath();
    ctx.fill();
    ctx.restore();
}

function drawTextLabel(
    ctx: CanvasRenderingContext2D,
    x: number, y: number,
    text: string,
    color: string,
): void {
    ctx.save();
    ctx.font = 'bold 14px system-ui, -apple-system, sans-serif';
    const metrics = ctx.measureText(text);
    const pad = 4;
    const bw = metrics.width + pad * 2;
    const bh = 20;
    // White background for readability
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.fillRect(x - pad, y - bh + pad, bw, bh);
    ctx.fillStyle = color;
    ctx.fillText(text, x, y);
    ctx.restore();
}

export function replayStrokes(
    ctx: CanvasRenderingContext2D,
    bgCanvas: HTMLCanvasElement,
    strokes: Stroke[],
): void {
    ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    ctx.drawImage(bgCanvas, 0, 0);
    for (const s of strokes) {
        if (s.kind === 'arrow') {
            drawArrow(ctx, s.x1, s.y1, s.x2, s.y2, s.color);
        } else {
            drawTextLabel(ctx, s.x, s.y, s.text, s.color);
        }
    }
}

async function enterAnnotate(el: Element): Promise<void> {
    // Find the annotate canvas in the shadow DOM
    const host = document.getElementById(HOST_ID);
    if (!host) return;
    const modal = host.shadowRoot!.querySelector<HTMLElement>('.annotate-modal');
    if (!modal) return;

    let bgCanvas: HTMLCanvasElement;

    try {
        // Capture the element with a fast pass; snapdom doesn't have a padding option
        // so we capture as-is. The captured area is the element's bounding box.
        const result = await snapdom(el as HTMLElement, { fast: true });
        bgCanvas = await result.toCanvas();
    } catch {
        // snapdom failed (test env, cross-origin, etc.); create blank canvas
        const rect = el.getBoundingClientRect();
        bgCanvas = document.createElement('canvas');
        bgCanvas.width = Math.max(1, Math.round(rect.width + 64));
        bgCanvas.height = Math.max(1, Math.round(rect.height + 64));
    }

    const canvasSlot = modal.querySelector<HTMLElement>('.annotate-canvas-wrap');
    if (!canvasSlot) return;
    // Replace canvas node
    const canvas = document.createElement('canvas');
    canvas.className = 'annotate-canvas';
    canvas.width = bgCanvas.width;
    canvas.height = bgCanvas.height;
    canvasSlot.innerHTML = '';
    canvasSlot.appendChild(canvas);

    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(bgCanvas, 0, 0);

    _annotateCanvas = canvas;
    _annotateCtx = ctx;
    _annotateBackground = bgCanvas;
    _annotateStrokes = [];
    _annotateTool = 'arrow';
    _annotateColor = 'red';

    updateAnnotateToolbar(modal);
    wireAnnotateCanvas(canvas, ctx, bgCanvas, modal);
}

function updateAnnotateToolbar(modal: HTMLElement): void {
    modal.querySelectorAll<HTMLElement>('[data-role=annotate-tool]').forEach((btn) => {
        btn.dataset.active = btn.dataset.tool === _annotateTool ? '1' : '';
    });
    modal.querySelectorAll<HTMLElement>('[data-role=annotate-color]').forEach((sw) => {
        sw.dataset.active = sw.dataset.color === _annotateColor ? '1' : '';
    });
}

function wireAnnotateCanvas(
    canvas: HTMLCanvasElement,
    ctx: CanvasRenderingContext2D,
    bgCanvas: HTMLCanvasElement,
    modal: HTMLElement,
): void {
    let dragging = false;
    let startX = 0;
    let startY = 0;

    const getXY = (ev: PointerEvent): { x: number; y: number } => {
        const rect = canvas.getBoundingClientRect();
        const scaleX = canvas.width / rect.width;
        const scaleY = canvas.height / rect.height;
        return {
            x: (ev.clientX - rect.left) * scaleX,
            y: (ev.clientY - rect.top) * scaleY,
        };
    };

    canvas.addEventListener('pointerdown', (ev: PointerEvent) => {
        ev.preventDefault();
        const { x, y } = getXY(ev);
        if (_annotateTool === 'arrow') {
            dragging = true;
            startX = x;
            startY = y;
        } else {
            spawnTextInput(canvas, ctx, bgCanvas, x, y, modal);
        }
    });

    canvas.addEventListener('pointermove', (ev: PointerEvent) => {
        if (!dragging || _annotateTool !== 'arrow') return;
        ev.preventDefault();
        const { x, y } = getXY(ev);
        replayStrokes(ctx, bgCanvas, _annotateStrokes);
        drawArrow(ctx, startX, startY, x, y, ANNOTATE_COLORS[_annotateColor]);
    });

    canvas.addEventListener('pointerup', (ev: PointerEvent) => {
        if (!dragging || _annotateTool !== 'arrow') return;
        dragging = false;
        ev.preventDefault();
        const { x, y } = getXY(ev);
        if (Math.abs(x - startX) < 3 && Math.abs(y - startY) < 3) return; // too short
        _annotateStrokes.push({
            kind: 'arrow',
            color: ANNOTATE_COLORS[_annotateColor],
            x1: startX, y1: startY,
            x2: x, y2: y,
        });
        replayStrokes(ctx, bgCanvas, _annotateStrokes);
    });

    // Toolbar button wiring
    modal.querySelectorAll<HTMLElement>('[data-role=annotate-tool]').forEach((btn) => {
        btn.onclick = () => {
            _annotateTool = (btn.dataset.tool as AnnotateTool) ?? 'arrow';
            updateAnnotateToolbar(modal);
        };
    });
    modal.querySelectorAll<HTMLElement>('[data-role=annotate-color]').forEach((sw) => {
        sw.onclick = () => {
            _annotateColor = (sw.dataset.color as AnnotateColor) ?? 'red';
            updateAnnotateToolbar(modal);
        };
    });
    const undoBtn = modal.querySelector<HTMLElement>('[data-role=annotate-undo]');
    if (undoBtn) {
        undoBtn.onclick = () => {
            _annotateStrokes.pop();
            replayStrokes(ctx, bgCanvas, _annotateStrokes);
        };
    }
}

function spawnTextInput(
    canvas: HTMLCanvasElement,
    ctx: CanvasRenderingContext2D,
    bgCanvas: HTMLCanvasElement,
    x: number,
    y: number,
    modal: HTMLElement,
): void {
    modal.querySelector('.annotate-text-input')?.remove();

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'annotate-text-input';
    input.maxLength = 140;
    input.placeholder = 'Type label…';

    const rect = canvas.getBoundingClientRect();
    const scaleX = rect.width / canvas.width;
    const scaleY = rect.height / canvas.height;
    input.style.cssText = `
        position: fixed;
        left: ${rect.left + x * scaleX}px;
        top: ${rect.top + y * scaleY - 20}px;
        z-index: 2147483647;
        font: bold 13px system-ui, sans-serif;
        border: 1px solid #3b82f6;
        border-radius: 4px;
        padding: 2px 6px;
        background: #fff;
        color: #111;
        outline: none;
        min-width: 120px;
    `;

    modal.appendChild(input);
    setTimeout(() => input.focus(), 0);

    const commit = () => {
        const text = input.value.trim();
        input.remove();
        if (!text) return;
        _annotateStrokes.push({
            kind: 'text',
            color: ANNOTATE_COLORS[_annotateColor],
            x, y,
            text,
        });
        replayStrokes(ctx, bgCanvas, _annotateStrokes);
    };

    input.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter') { ev.preventDefault(); commit(); }
        if (ev.key === 'Escape') { ev.preventDefault(); input.remove(); }
    });
    input.addEventListener('blur', commit);
}

/**
 * Flatten strokes onto the background canvas and return as a TaskAttachment.
 * Exported for testing.
 */
export async function finalizeAnnotation(): Promise<TaskAttachment | null> {
    if (!_annotateCanvas || !_annotateCtx || !_annotateBackground) return null;
    const ctx = _annotateCtx;
    const bgCanvas = _annotateBackground;
    const canvas = _annotateCanvas;
    replayStrokes(ctx, bgCanvas, _annotateStrokes);
    const dataUrl = canvas.toDataURL('image/png', 0.85);
    const base64 = dataUrl.replace(/^data:image\/png;base64,/, '');
    const id = `att_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    const att: TaskAttachment = {
        id,
        kind: 'screenshot',
        data: base64,
        width: canvas.width,
        height: canvas.height,
    };
    resetAnnotateStrokes();
    return att;
}

// ─── Plugin helpers (screenshot / logs) ───────────────────────────────────

/**
 * Rasterize an element to a PNG TaskAttachment via snapdom. Returns null on
 * failure (cross-origin, test env, …) so plugins can degrade gracefully.
 * Exported for testing.
 */
export async function captureElementPng(el: Element): Promise<TaskAttachment | null> {
    try {
        const result = await snapdom(el as HTMLElement, { fast: true });
        const canvas = await result.toCanvas();
        const dataUrl = canvas.toDataURL('image/png', 0.85);
        const base64 = dataUrl.replace(/^data:image\/png;base64,/, '');
        return {
            id: `att_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
            kind: 'screenshot',
            data: base64,
            width: canvas.width || 1,
            height: canvas.height || 1,
        };
    } catch {
        return null;
    }
}

const SENSITIVE_HEADER_RE = /^(authorization|cookie|set-cookie|proxy-authorization)$/i;

/** Strip bodies + auth/cookie headers from a network entry. */
function redactNetworkEntry(e: NetworkEntry): NetworkEntry {
    const out: NetworkEntry = { ...e };
    delete out.requestBody;
    delete out.responseBody;
    delete out.requestBodyTruncated;
    delete out.responseBodyTruncated;
    for (const key of ['requestHeaders', 'responseHeaders'] as const) {
        const h = out[key];
        if (h) {
            const safe: Record<string, string> = {};
            for (const [k, v] of Object.entries(h)) {
                if (!SENSITIVE_HEADER_RE.test(k)) safe[k] = v;
            }
            out[key] = safe;
        }
    }
    return out;
}

/** Read recent buffered logs for the plugin context. Redacts network by default. */
export function collectLogs(opts: OverlayPluginGetLogsOptions = {}): OverlayPluginLogs {
    const store = getCaptureStore();
    const redact = opts.redact !== false;
    const network = store.network.tail(opts.network ?? 0);
    return {
        console: store.console.tail(opts.console ?? 0),
        errors: store.errors.tail(opts.errors ?? 0),
        network: redact ? network.map(redactNetworkEntry) : network,
    };
}

// ─── DOM builders ────────────────────────────────────────────────────────

function buildStyle(): HTMLStyleElement {
    const style = document.createElement('style');
    style.textContent = `
        :host { all: initial; }
        .fab {
            position: fixed;
            width: 40px;
            height: 40px;
            border-radius: 12px;
            background: linear-gradient(135deg, #1f2937 0%, #111827 100%);
            color: #fff;
            border: 1px solid rgba(255, 255, 255, 0.08);
            cursor: grab;
            touch-action: none;
            box-shadow:
                0 1px 0 rgba(255, 255, 255, 0.06) inset,
                0 8px 24px -4px rgba(0, 0, 0, 0.45),
                0 2px 6px rgba(0, 0, 0, 0.35);
            font: 600 14px/1 'Inter', system-ui, -apple-system, sans-serif;
            letter-spacing: 0.02em;
            display: flex;
            align-items: center;
            justify-content: center;
            z-index: 2147483646;
            transition: transform 0.15s ease, box-shadow 0.2s ease, border-color 0.2s ease;
            opacity: 0.92;
        }
        .fab:hover {
            opacity: 1;
            transform: translateY(-1px);
            border-color: rgba(129, 140, 248, 0.4);
            box-shadow:
                0 1px 0 rgba(255, 255, 255, 0.08) inset,
                0 0 0 1px rgba(129, 140, 248, 0.3),
                0 12px 28px -4px rgba(0, 0, 0, 0.5),
                0 4px 10px rgba(0, 0, 0, 0.4);
        }
        .fab:active { cursor: grabbing; transform: translateY(0); }
        .fab[data-dragging="1"] {
            cursor: grabbing;
            opacity: 1;
            transition: none;
            box-shadow:
                0 1px 0 rgba(255, 255, 255, 0.1) inset,
                0 0 0 1px rgba(129, 140, 248, 0.45),
                0 18px 36px -6px rgba(0, 0, 0, 0.6);
        }
        .fab[data-state="active"] {
            background: linear-gradient(135deg, #dc2626 0%, #991b1b 100%);
            border-color: rgba(248, 113, 113, 0.4);
            opacity: 1;
        }
        .fab[data-state="flash"] {
            background: linear-gradient(135deg, #10b981 0%, #047857 100%);
            border-color: rgba(52, 211, 153, 0.4);
            opacity: 1;
        }

        .info-card {
            position: fixed;
            width: 300px;
            background: rgba(17, 17, 20, 0.92);
            color: #e4e4e7;
            border: 1px solid rgba(255, 255, 255, 0.08);
            border-radius: 12px;
            box-shadow:
                0 1px 0 rgba(255, 255, 255, 0.04) inset,
                0 18px 50px -8px rgba(0, 0, 0, 0.6),
                0 4px 12px rgba(0, 0, 0, 0.4);
            backdrop-filter: blur(14px) saturate(180%);
            -webkit-backdrop-filter: blur(14px) saturate(180%);
            padding: 14px;
            display: none;
            flex-direction: column;
            gap: 10px;
            z-index: 2147483646;
            font: 13px/1.4 'Inter', system-ui, -apple-system, sans-serif;
            animation: fade-in 180ms ease-out;
        }
        @keyframes fade-in {
            from { opacity: 0; transform: translateY(2px); }
            to   { opacity: 1; transform: translateY(0); }
        }
        .info-card .bar {
            display: flex;
            align-items: center;
            gap: 8px;
            padding-bottom: 10px;
            border-bottom: 1px solid rgba(255, 255, 255, 0.06);
        }
        .info-card .bar .proj {
            font-weight: 600;
            flex: 1;
            min-width: 0;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
            color: #f4f4f5;
        }
        .info-card .dot {
            width: 8px;
            height: 8px;
            border-radius: 50%;
            background: #71717a;
            flex-shrink: 0;
        }
        .info-card .dot[data-state="open"] {
            background: #34d399;
            box-shadow: 0 0 0 3px rgba(52, 211, 153, 0.15);
            animation: pulse 2s ease-in-out infinite;
        }
        .info-card .dot[data-state="connecting"] {
            background: #fbbf24;
            animation: blink 0.6s ease-in-out infinite;
        }
        .info-card .conn { color: #a1a1aa; font-size: 11px; flex-shrink: 0; }
        .info-card .close-btn {
            background: none;
            border: none;
            color: #71717a;
            cursor: pointer;
            padding: 0;
            width: 18px;
            height: 18px;
            font-size: 16px;
            line-height: 1;
            flex-shrink: 0;
            border-radius: 4px;
            transition: color 0.12s ease, background 0.12s ease;
        }
        .info-card .close-btn:hover { color: #f4f4f5; background: rgba(255, 255, 255, 0.06); }

        .info-card .rows { display: flex; flex-direction: column; gap: 6px; }
        .info-card .row {
            display: flex;
            align-items: center;
            gap: 8px;
            font-size: 12px;
        }
        .info-card .row .key {
            color: #71717a;
            width: 60px;
            flex-shrink: 0;
            font-size: 10px;
            text-transform: uppercase;
            letter-spacing: 0.06em;
            font-weight: 500;
        }
        .info-card .pill {
            font-family: 'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace;
            font-size: 11px;
            background: rgba(255, 255, 255, 0.04);
            border-radius: 5px;
            padding: 3px 7px;
            color: #d4d4d8;
            cursor: pointer;
            border: 1px solid rgba(255, 255, 255, 0.04);
            transition: background 0.12s ease, border-color 0.12s ease, color 0.12s ease;
            user-select: none;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
            max-width: 100%;
            min-width: 0;
        }
        .info-card .pill:hover { background: rgba(255, 255, 255, 0.08); border-color: rgba(255, 255, 255, 0.12); color: #f4f4f5; }
        .info-card .pill[data-copied="1"] {
            background: rgba(52, 211, 153, 0.12);
            color: #34d399;
            border-color: rgba(52, 211, 153, 0.3);
        }
        .info-card .pill.url {
            cursor: default;
            background: transparent;
            color: #a1a1aa;
            padding: 0;
            border-color: transparent;
        }
        .info-card .pill.url:hover { background: transparent; border-color: transparent; }

        .info-card .actions { display: flex; flex-direction: column; gap: 8px; margin-top: 4px; }
        .info-card .primary {
            background: linear-gradient(135deg, #6366f1 0%, #4f46e5 100%);
            color: #fff;
            border: 1px solid rgba(129, 140, 248, 0.4);
            border-radius: 8px;
            padding: 10px 12px;
            font: 600 13px/1.2 'Inter', system-ui, sans-serif;
            cursor: pointer;
            text-align: left;
            display: flex;
            align-items: center;
            gap: 10px;
            transition: filter 0.15s ease, box-shadow 0.15s ease;
            box-shadow: 0 4px 12px -2px rgba(99, 102, 241, 0.3);
        }
        .info-card .primary:hover { filter: brightness(1.1); box-shadow: 0 6px 16px -2px rgba(99, 102, 241, 0.4); }
        .info-card .primary .icon { font-size: 16px; }
        .info-card .primary .label { flex: 1; }
        .info-card .primary .hint {
            font-size: 11px;
            color: rgba(255, 255, 255, 0.7);
            font-weight: 400;
        }

        .info-card .secondary {
            background: rgba(255, 255, 255, 0.03);
            color: #d4d4d8;
            border: 1px solid rgba(255, 255, 255, 0.08);
            border-radius: 8px;
            padding: 9px 12px;
            font: 500 12px/1.2 'Inter', system-ui, sans-serif;
            cursor: pointer;
            display: flex;
            align-items: center;
            gap: 8px;
            transition: background 0.12s ease, border-color 0.12s ease;
        }
        .info-card .secondary:hover { background: rgba(255, 255, 255, 0.06); border-color: rgba(255, 255, 255, 0.16); color: #f4f4f5; }
        .info-card .secondary[data-copied="1"] {
            background: rgba(52, 211, 153, 0.12);
            color: #34d399;
            border-color: rgba(52, 211, 153, 0.3);
        }

        .info-card .plugin-actions {
            display: flex;
            flex-direction: column;
            gap: 8px;
            margin-top: 8px;
            padding-top: 8px;
            border-top: 1px solid rgba(255, 255, 255, 0.06);
        }
        .info-card .promo {
            margin-top: 8px;
            text-align: center;
        }
        .info-card .promo-link {
            color: #a1a1aa;
            font-size: 11px;
            text-decoration: none;
            opacity: 0.7;
        }
        .info-card .promo-link:hover { color: #f4f4f5; opacity: 1; }

        .hfe-toast {
            position: fixed;
            bottom: 64px;
            left: 50%;
            transform: translate(-50%, 8px);
            max-width: 320px;
            padding: 8px 14px;
            background: #111827;
            color: #f4f4f5;
            border: 1px solid rgba(255, 255, 255, 0.12);
            border-radius: 10px;
            font: 500 12px/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
            box-shadow: 0 6px 24px rgba(0, 0, 0, 0.4);
            opacity: 0;
            transition: opacity 0.2s ease, transform 0.2s ease;
            z-index: 2147483647;
            pointer-events: none;
        }
        .hfe-toast[data-show="1"] { opacity: 1; transform: translate(-50%, 0); }
        .hfe-toast[data-kind="error"] { border-color: rgba(248, 113, 113, 0.4); color: #fca5a5; }

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
            width: 320px;
            background: rgba(17, 17, 20, 0.92);
            color: #e4e4e7;
            border: 1px solid rgba(255, 255, 255, 0.08);
            border-radius: 12px;
            box-shadow:
                0 1px 0 rgba(255, 255, 255, 0.04) inset,
                0 18px 50px -8px rgba(0, 0, 0, 0.6);
            backdrop-filter: blur(14px) saturate(180%);
            -webkit-backdrop-filter: blur(14px) saturate(180%);
            padding: 14px;
            display: none;
            flex-direction: column;
            gap: 10px;
            z-index: 2147483646;
            font: 13px/1.4 'Inter', system-ui, sans-serif;
            animation: fade-in 180ms ease-out;
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

        .question .attach-area {
            display: flex;
            flex-direction: column;
            gap: 6px;
            margin-top: -2px;
        }
        .question .add-shot {
            display: inline-flex;
            align-self: flex-start;
            align-items: center;
            gap: 6px;
            background: #f3f4f6;
            color: #374151;
            border: 1px dashed #d1d5db;
            border-radius: 6px;
            padding: 6px 10px;
            font: 500 12px/1.2 system-ui, sans-serif;
            cursor: pointer;
            transition: background 0.12s ease, border-color 0.12s ease;
        }
        .question .add-shot:hover {
            background: #e5e7eb;
            border-color: #9ca3af;
            border-style: solid;
        }
        .question .thumb-preview {
            display: flex;
            gap: 8px;
            align-items: stretch;
            background: #f9fafb;
            border: 1px solid #e5e7eb;
            border-radius: 6px;
            padding: 6px;
        }
        .question .thumb-preview img {
            max-width: 120px;
            max-height: 90px;
            object-fit: contain;
            border-radius: 4px;
            background: #fff;
            display: block;
        }
        .question .thumb-preview .thumb-meta {
            display: flex;
            flex-direction: column;
            justify-content: space-between;
            font-size: 11px;
            color: #6b7280;
            flex: 1;
            min-width: 0;
        }
        .question .thumb-preview .thumb-meta button {
            background: transparent;
            border: 1px solid transparent;
            color: #6b7280;
            font: 500 11px/1.2 system-ui, sans-serif;
            padding: 3px 6px;
            border-radius: 4px;
            cursor: pointer;
            text-align: left;
        }
        .question .thumb-preview .thumb-meta button:hover {
            background: #f3f4f6;
            color: #111;
            border-color: #d1d5db;
        }
        .question .thumb-preview .thumb-remove:hover {
            background: #fee2e2;
            color: #991b1b;
            border-color: #fecaca;
        }

        .reports-card {
            position: fixed;
            width: 320px;
            max-height: 480px;
            background: rgba(17, 17, 20, 0.92);
            color: #e4e4e7;
            border: 1px solid rgba(255, 255, 255, 0.08);
            border-radius: 12px;
            box-shadow:
                0 1px 0 rgba(255, 255, 255, 0.04) inset,
                0 18px 50px -8px rgba(0, 0, 0, 0.6);
            backdrop-filter: blur(14px) saturate(180%);
            -webkit-backdrop-filter: blur(14px) saturate(180%);
            display: none;
            flex-direction: column;
            z-index: 2147483646;
            font: 13px/1.4 'Inter', system-ui, -apple-system, sans-serif;
            overflow: hidden;
            animation: fade-in 180ms ease-out;
        }
        .reports-card .bar {
            display: flex;
            align-items: center;
            gap: 8px;
            padding: 12px 14px 10px;
            border-bottom: 1px solid #f3f4f6;
        }
        .reports-card .back-btn,
        .reports-card .refresh-btn,
        .reports-card .close-btn {
            background: none;
            border: none;
            color: #6b7280;
            cursor: pointer;
            padding: 2px 4px;
            font-size: 15px;
            line-height: 1;
        }
        .reports-card .back-btn:hover,
        .reports-card .refresh-btn:hover,
        .reports-card .close-btn:hover { color: #111; }
        .reports-card .title { flex: 1; font-weight: 600; }
        .reports-card .count { color: #6b7280; font-size: 11px; }
        .reports-card .list {
            overflow-y: auto;
            padding: 6px 0;
            flex: 1;
        }
        .reports-card .loading,
        .reports-card .empty {
            color: #6b7280;
            padding: 24px 14px;
            text-align: center;
            font-size: 12px;
        }
        .reports-card .empty.error { color: #b91c1c; }
        .reports-card .task-row {
            padding: 10px 14px;
            border-bottom: 1px solid #f9fafb;
            display: flex;
            flex-direction: column;
            gap: 4px;
        }
        .reports-card .task-row:last-child { border-bottom: none; }
        .reports-card .task-row .status {
            font-size: 11px;
            color: #6b7280;
            font-weight: 500;
        }
        .reports-card .task-row[data-status="pending"] .status { color: #b45309; }
        .reports-card .task-row[data-status="claimed"] .status { color: #1e40af; }
        .reports-card .task-row[data-status="resolved"] .status { color: #047857; }
        .reports-card .task-row .ago { color: #9ca3af; font-weight: 400; }
        .reports-card .task-row .q {
            color: #111;
            font-size: 13px;
            line-height: 1.45;
            word-break: break-word;
        }
        .reports-card .task-row .note {
            background: #f0fdf4;
            border-left: 3px solid #16a34a;
            padding: 4px 8px;
            border-radius: 3px;
            color: #047857;
            font-size: 12px;
            margin-top: 2px;
        }
        .reports-card .task-row .meta {
            color: #6b7280;
            font-size: 11px;
            font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
            word-break: break-all;
        }
        .reports-card .task-row .edit-area {
            width: 100%;
            box-sizing: border-box;
            min-height: 50px;
            border: 1px solid #d1d5db;
            border-radius: 5px;
            padding: 6px 8px;
            font: inherit;
            resize: vertical;
        }
        .reports-card .task-row .row-actions {
            display: flex;
            gap: 6px;
            margin-top: 4px;
        }
        .reports-card .task-row .rl-btn {
            background: #f3f4f6;
            color: #374151;
            border: 1px solid transparent;
            border-radius: 5px;
            padding: 3px 8px;
            font: 500 11px/1.2 system-ui, sans-serif;
            cursor: pointer;
            transition: background 0.12s ease;
        }
        .reports-card .task-row .rl-btn:hover { background: #e5e7eb; }
        .reports-card .task-row .rl-btn.ghost {
            background: transparent;
            color: #9ca3af;
        }
        .reports-card .task-row .rl-btn.ghost:hover { background: #f3f4f6; color: #6b7280; }
        .reports-card .task-row .rl-btn.danger {
            background: #fee2e2;
            color: #991b1b;
        }
        .reports-card .task-row .rl-btn.danger:hover { background: #fecaca; }

        @keyframes pulse {
            0%, 100% { box-shadow: 0 0 0 0 rgba(16, 185, 129, 0.4); }
            50%      { box-shadow: 0 0 0 4px rgba(16, 185, 129, 0); }
        }
        @keyframes blink {
            0%, 100% { opacity: 1; }
            50%      { opacity: 0.4; }
        }

        /* ── Annotate modal ── */
        .annotate-modal {
            position: fixed;
            inset: 0;
            background: rgba(0,0,0,0.72);
            z-index: 2147483646;
            display: none;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            gap: 10px;
            padding: 16px;
            box-sizing: border-box;
        }
        .annotate-toolbar {
            display: flex;
            align-items: center;
            gap: 8px;
            background: #1f2937;
            border-radius: 8px;
            padding: 6px 10px;
        }
        .annotate-toolbar button {
            background: rgba(255,255,255,0.08);
            border: 1px solid transparent;
            border-radius: 5px;
            color: #e5e7eb;
            cursor: pointer;
            font: 12px/1 system-ui, sans-serif;
            padding: 4px 9px;
            transition: background 0.12s ease;
        }
        .annotate-toolbar button:hover { background: rgba(255,255,255,0.15); }
        .annotate-toolbar button[data-active="1"] {
            background: rgba(255,255,255,0.22);
            border-color: rgba(255,255,255,0.3);
        }
        .annotate-swatch {
            width: 16px;
            height: 16px;
            border-radius: 50%;
            cursor: pointer;
            border: 2px solid transparent;
            outline: none;
            flex-shrink: 0;
            display: inline-block;
        }
        .annotate-swatch[data-active="1"] { border-color: #fff; }
        .annotate-sep { width: 1px; height: 20px; background: rgba(255,255,255,0.15); }
        .annotate-canvas-wrap {
            max-width: 100%;
            max-height: calc(100vh - 120px);
            overflow: auto;
            border-radius: 6px;
            box-shadow: 0 8px 32px rgba(0,0,0,0.4);
        }
        .annotate-canvas {
            display: block;
            cursor: crosshair;
            max-width: 100%;
        }
        .annotate-hint {
            color: #9ca3af;
            font: 11px system-ui, sans-serif;
        }
        .annotate-actions {
            display: flex;
            gap: 8px;
        }
        .annotate-actions button {
            border-radius: 7px;
            padding: 8px 16px;
            font: 500 13px system-ui, sans-serif;
            cursor: pointer;
            border: 1px solid transparent;
        }
        .annotate-actions .ann-cancel {
            background: rgba(255,255,255,0.08);
            color: #d1d5db;
            border-color: rgba(255,255,255,0.15);
        }
        .annotate-actions .ann-cancel:hover { background: rgba(255,255,255,0.14); }
        .annotate-actions .ann-done {
            background: #2563eb;
            color: #fff;
        }
        .annotate-actions .ann-done:hover { background: #1d4ed8; }

        /* thumbnail in reports */
        .task-thumb {
            max-height: 80px;
            max-width: 120px;
            border-radius: 4px;
            cursor: pointer;
            border: 1px solid #e5e7eb;
            object-fit: contain;
            margin-top: 4px;
        }
        /* lightbox */
        .thumb-lightbox {
            position: fixed;
            inset: 0;
            background: rgba(0,0,0,0.8);
            z-index: 2147483647;
            display: flex;
            align-items: center;
            justify-content: center;
            cursor: zoom-out;
        }
        .thumb-lightbox img {
            max-width: 90vw;
            max-height: 90vh;
            border-radius: 8px;
            box-shadow: 0 16px 48px rgba(0,0,0,0.5);
        }
    `;
    return style;
}

function buildFab(): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.className = 'fab';
    btn.dataset.state = 'idle';
    btn.title = 'Harness-FE · click to open (Cmd+Shift+H)';
    btn.setAttribute('aria-label', 'Open Harness-FE panel');
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
            <button class="secondary" data-role="open-dashboard" type="button" style="display:none">
                <span class="icon">↗</span>
                <span>Open dashboard</span>
            </button>
            <button class="secondary" data-role="view-reports" type="button">📁 My reports</button>
            <button class="secondary" data-role="copy-snapshot" type="button">📋 Copy snapshot</button>
        </div>
        <div class="plugin-actions" data-role="plugin-actions" style="display:none"></div>
        <div class="promo">
            <a class="promo-link" data-role="github" href="${GITHUB_URL}" target="_blank" rel="noopener noreferrer">⭐ Harness-FE on GitHub</a>
        </div>
    `;
    return card;
}

function buildReportsCard(): HTMLDivElement {
    const card = document.createElement('div');
    card.className = 'reports-card';
    card.innerHTML = `
        <div class="bar">
            <button class="back-btn" data-role="back" title="Back" type="button">←</button>
            <span class="title">My reports</span>
            <span class="count" data-role="count"></span>
            <button class="refresh-btn" data-role="refresh" title="Refresh" type="button">↻</button>
            <button class="close-btn" data-role="close" title="Close (Esc)" type="button">×</button>
        </div>
        <div class="list" data-role="list">
            <div class="loading" data-role="loading">Loading…</div>
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

function buildAnnotateModal(): HTMLDivElement {
    const modal = document.createElement('div');
    modal.className = 'annotate-modal';
    modal.innerHTML = `
        <div class="annotate-toolbar">
            <button data-role="annotate-tool" data-tool="arrow" title="Arrow tool">↗ Arrow</button>
            <button data-role="annotate-tool" data-tool="text" title="Text tool">T Text</button>
            <button data-role="annotate-undo" title="Undo last stroke">↩ Undo</button>
            <span class="annotate-sep"></span>
            <span class="annotate-swatch" data-role="annotate-color" data-color="red"
                  style="background:#ef4444" title="Red"></span>
            <span class="annotate-swatch" data-role="annotate-color" data-color="blue"
                  style="background:#3b82f6" title="Blue"></span>
            <span class="annotate-swatch" data-role="annotate-color" data-color="yellow"
                  style="background:#eab308" title="Yellow"></span>
            <span class="annotate-swatch" data-role="annotate-color" data-color="green"
                  style="background:#22c55e" title="Green"></span>
            <span class="annotate-swatch" data-role="annotate-color" data-color="black"
                  style="background:#111827" title="Black"></span>
        </div>
        <div class="annotate-canvas-wrap"></div>
        <div class="annotate-hint">Draw arrows or add text, then click Done · Esc to go back</div>
        <div class="annotate-actions">
            <button class="ann-cancel" data-role="annotate-cancel" type="button">Cancel</button>
            <button class="ann-done" data-role="annotate-done" type="button">Done</button>
        </div>
    `;
    return modal;
}

function buildQuestionPanel(): HTMLDivElement {
    const panel = document.createElement('div');
    panel.className = 'question';
    panel.innerHTML = `
        <h3>What's wrong with this element?</h3>
        <div class="info" data-role="info"></div>
        <textarea placeholder="Describe the problem, expected behavior, or what the agent should do…"></textarea>
        <div class="attach-area" data-role="attach-area">
            <button class="add-shot" data-role="add-shot" type="button">📷 Add screenshot</button>
            <div class="thumb-preview" data-role="thumb-preview" style="display: none;">
                <img data-role="thumb-img" alt="screenshot preview" />
                <div class="thumb-meta">
                    <span data-role="thumb-dims"></span>
                    <button class="thumb-edit" data-role="thumb-edit" type="button" title="Re-annotate">✎ Edit</button>
                    <button class="thumb-remove" data-role="thumb-remove" type="button" title="Remove">×</button>
                </div>
            </div>
        </div>
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

/**
 * Browser-consent modal (4.0 · P2). Self-contained inline styles (no reliance
 * on buildStyle) — a fixed, centered card with command preview + 3 choices.
 */
function buildConsentPanel(): HTMLDivElement {
    const panel = document.createElement('div');
    panel.className = 'consent';
    panel.style.cssText = [
        'display:none', 'position:fixed', 'left:50%', 'top:24px', 'transform:translateX(-50%)',
        'z-index:2147483647', 'flex-direction:column', 'gap:10px', 'max-width:380px',
        'width:calc(100% - 32px)', 'box-sizing:border-box', 'padding:16px',
        'background:#fff', 'color:#111', 'border:1px solid #e5e7eb', 'border-radius:10px',
        'box-shadow:0 8px 28px rgba(0,0,0,.16)',
        'font:13px/1.45 -apple-system,BlinkMacSystemFont,system-ui,sans-serif',
    ].join(';');
    panel.innerHTML = `
        <div style="font-weight:600">Agent wants to control this page</div>
        <code data-role="consent-cmd" style="display:block;padding:8px 10px;background:#f6f6f7;border-radius:6px;font:12px ui-monospace,SFMono-Regular,Menlo,monospace;word-break:break-all"></code>
        <div style="display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap">
            <button data-role="consent-deny" type="button" style="padding:7px 12px;border:1px solid #d1d5db;border-radius:6px;background:#fff;color:#111;cursor:pointer">Deny</button>
            <button data-role="consent-session" type="button" style="padding:7px 12px;border:0;border-radius:6px;background:#f0f0f0;color:#111;cursor:pointer">Allow for session</button>
            <button data-role="consent-once" type="button" style="padding:7px 12px;border:0;border-radius:6px;background:#111;color:#fff;cursor:pointer">Allow once</button>
        </div>
    `;
    return panel;
}

/** Render a control command + its most telling arg for the consent prompt. */
function formatConsentCommand(req: ConsentRequest): string {
    const args = req.args && typeof req.args === 'object'
        ? (req.args as Record<string, unknown>)
        : undefined;
    const detail = args?.selector ?? args?.url ?? args?.expr ?? args?.value ?? args?.predicate;
    if (detail === undefined) return req.command;
    const s = String(detail);
    return `${req.command}(${s.length > 80 ? `${s.slice(0, 80)}…` : s})`;
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

function buildPayload(el: Element, question: string, attachment?: TaskAttachment): TaskSubmitPayload {
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
            outerHTML: truncate(stripInternalAttrs(el.outerHTML), MAX_OUTER_HTML),
            rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
        },
        attachments: attachment ? [attachment] : undefined,
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

function escapeHtml(s: string): string {
    return s
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function escapeAttr(s: string): string {
    return s.replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function formatAgo(ts: number): string {
    const diff = Date.now() - ts;
    if (diff < 60_000) return 'just now';
    if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
    if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
    const days = Math.floor(diff / 86_400_000);
    return days < 30 ? `${days}d ago` : new Date(ts).toLocaleDateString();
}
