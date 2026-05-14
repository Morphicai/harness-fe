/**
 * Runtime client core. Connects to the MCP server over WS, executes
 * commands dispatched by the server, and forwards page events back.
 *
 * Started lazily by `auto-start.ts` when the script is imported.
 */

import {
    COMMAND,
    DEFAULT_WS_PORT,
    type CommandFrame,
    type EventFrame,
    type Frame,
    type HelloFrame,
    type ResponseFrame,
    frameSchema,
} from '@morphixai/harnessa-fe.protocol';
import { getCaptureStore } from './capture.js';
import { commandHandlers, type CommandContext } from './commands.js';

export interface ClientOptions {
    projectId: string;
    mcpUrl?: string;
}

const TAB_ID_KEY = '__hfe_tab_id__';

function getOrCreateTabId(): string {
    try {
        const existing = sessionStorage.getItem(TAB_ID_KEY);
        if (existing) return existing;
        const id = `${Date.now().toString(36)}-${crypto.randomUUID().slice(0, 8)}`;
        sessionStorage.setItem(TAB_ID_KEY, id);
        return id;
    } catch {
        return `${Date.now().toString(36)}-${crypto.randomUUID().slice(0, 8)}`;
    }
}

export class RuntimeClient {
    private ws?: WebSocket;
    private readonly tabId = getOrCreateTabId();
    private readonly ctx: CommandContext = { capture: getCaptureStore() };
    private reconnectAttempts = 0;
    private closed = false;

    constructor(private readonly opts: ClientOptions) {}

    start(): void {
        this.ctx.capture.install((name, payload) => this.sendEvent(name, payload));
        this.connect();
    }

    stop(): void {
        this.closed = true;
        this.ws?.close();
    }

    private connect(): void {
        const url = this.opts.mcpUrl ?? `ws://127.0.0.1:${DEFAULT_WS_PORT}`;
        try {
            this.ws = new WebSocket(url);
        } catch (err) {
            console.warn('[morphix-dev-bridge] failed to construct WebSocket', err);
            return;
        }
        this.ws.addEventListener('open', () => this.onOpen());
        this.ws.addEventListener('message', (ev) => this.onMessage(ev));
        this.ws.addEventListener('close', () => this.onClose());
        this.ws.addEventListener('error', () => {
            /* close will follow */
        });
    }

    private onOpen(): void {
        this.reconnectAttempts = 0;
        const hello: HelloFrame = {
            type: 'hello',
            id: crypto.randomUUID(),
            role: 'runtime-client',
            projectId: this.opts.projectId,
            tabId: this.tabId,
            page: {
                url: location.href,
                title: document.title,
                userAgent: navigator.userAgent,
            },
        };
        this.send(hello);
    }

    private onClose(): void {
        if (this.closed) return;
        const delay = Math.min(15_000, 500 * 2 ** Math.min(this.reconnectAttempts, 5));
        this.reconnectAttempts++;
        setTimeout(() => {
            if (!this.closed) this.connect();
        }, delay);
    }

    private onMessage(ev: MessageEvent): void {
        let parsed: unknown;
        try {
            parsed = JSON.parse(String(ev.data));
        } catch {
            return;
        }
        const result = frameSchema.safeParse(parsed);
        if (!result.success) return;
        const frame = result.data;
        if (frame.type === 'command') this.handleCommand(frame);
    }

    private async handleCommand(frame: CommandFrame): Promise<void> {
        const handler = commandHandlers[frame.command];
        if (!handler) {
            this.send({
                type: 'response',
                id: frame.id,
                ok: false,
                error: { code: 'UNKNOWN_COMMAND', message: `no handler for "${frame.command}"` },
            } satisfies ResponseFrame);
            return;
        }
        try {
            const result = await handler(frame.args ?? {}, this.ctx);
            this.send({
                type: 'response',
                id: frame.id,
                ok: true,
                result,
            } satisfies ResponseFrame);
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            this.send({
                type: 'response',
                id: frame.id,
                ok: false,
                error: { message },
            } satisfies ResponseFrame);
        }
    }

    sendEvent(name: string, payload: unknown): void {
        const event: EventFrame = {
            type: 'event',
            id: crypto.randomUUID(),
            tabId: this.tabId,
            projectId: this.opts.projectId,
            name,
            ts: Date.now(),
            payload,
        };
        this.send(event);
    }

    private send(frame: Frame): void {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
        try {
            this.ws.send(JSON.stringify(frame));
        } catch {
            /* swallow */
        }
    }
}

/** Pull the well-known config object planted by the Vite plugin on window. */
export function readInjectedConfig(): { projectId: string; mcpUrl?: string } {
    const w = window as unknown as {
        __HARNESSA_FE__?: { projectId?: string; mcpUrl?: string };
    };
    return {
        projectId: w.__HARNESSA_FE__?.projectId ?? 'unknown-project',
        mcpUrl: w.__HARNESSA_FE__?.mcpUrl,
    };
}

/** Re-export command names for outside callers. */
export { COMMAND };
