/**
 * MCP WebSocket client + command dispatch loop, factored out of the unplugin
 * core so the native webpack plugin can reuse it without depending on the
 * unplugin webpack adapter (which carries circular references via the plugin
 * instance and breaks thread-loader serialization).
 *
 * The componentMap is supplied by the caller — vite/rspack pass their shared
 * map; the webpack plugin passes its shared-state map keyed by pluginId.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { WebSocket } from 'ws';
import {
    COMMAND,
    type CommandFrame,
    type EventFrame,
    type Frame,
    type HelloFrame,
    type ResponseFrame,
    frameSchema,
} from '@harness-fe/protocol';
import type { McpClient, McpClientContext } from './types.js';

function newId(): string {
    const g = globalThis as { crypto?: { randomUUID?: () => string } };
    return g.crypto?.randomUUID ? g.crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
}

export function createMcpClient(ctx: McpClientContext): McpClient {
    let ws: WebSocket | undefined;
    let isActive = false;

    function send(frame: EventFrame | HelloFrame | ResponseFrame): void {
        if (!ws || ws.readyState !== WebSocket.OPEN) return;
        try {
            ws.send(JSON.stringify(frame));
        } catch {
            /* swallow */
        }
    }

    async function runCommand(command: string, args: unknown): Promise<unknown> {
        switch (command) {
            case COMMAND.PROJECT_SOURCE: {
                const a = args as { file?: string; component?: string };
                let file = a.file;
                if (!file && a.component) {
                    const locs = ctx.componentMap.get(a.component);
                    if (!locs?.length) {
                        throw new Error(
                            `project.source: component "${a.component}" not found in the scan`,
                        );
                    }
                    file = locs[0].file;
                }
                if (!file) {
                    throw new Error('project.source: pass either `file` or `component`');
                }
                const abs = resolve(ctx.projectRoot, file);
                if (!abs.startsWith(ctx.projectRoot)) {
                    throw new Error(
                        `project.source: refusing to read outside project root: ${file}`,
                    );
                }
                const content = readFileSync(abs, 'utf-8');
                return { file, content };
            }
            case COMMAND.PROJECT_WHERE_IS: {
                const a = args as { component: string };
                const locs = ctx.componentMap.get(a.component);
                if (!locs?.length) {
                    throw new Error(`project.where_is: component "${a.component}" not found`);
                }
                return { component: a.component, locations: locs };
            }
            case COMMAND.PROJECT_MODULE_GRAPH: {
                const components: Record<string, Array<{ file: string; line: number; col: number }>> = {};
                for (const [name, locs] of ctx.componentMap.entries()) {
                    components[name] = locs;
                }
                return {
                    components,
                    totalFiles: new Set(
                        [...ctx.componentMap.values()].flat().map((l) => l.file),
                    ).size,
                };
            }
            default:
                throw new Error(`harness-fe: unhandled command "${command}"`);
        }
    }

    async function handleCommand(frame: CommandFrame): Promise<void> {
        let response: ResponseFrame;
        try {
            const result = await runCommand(frame.command, frame.args);
            response = { type: 'response', id: frame.id, ok: true, result };
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            response = { type: 'response', id: frame.id, ok: false, error: { message } };
        }
        send(response);
    }

    function connect(): void {
        if (isActive) return;
        isActive = true;
        connectInternal();
    }

    function connectInternal(): void {
        try {
            const headers: Record<string, string> = {};
            if (ctx.token) headers.authorization = `Bearer ${ctx.token}`;
            ws = new WebSocket(ctx.mcpUrl, { headers });
            ws.on('open', () => {
                const hello: HelloFrame = {
                    type: 'hello',
                    id: newId(),
                    role: ctx.peerRole,
                    projectId: ctx.projectId,
                    parentProjectId: ctx.parentProjectId,
                    displayName: ctx.getDisplayName(),
                    buildId: ctx.getBuildId(),
                };
                send(hello);
            });
            ws.on('message', (raw) => {
                let parsed: unknown;
                try {
                    parsed = JSON.parse(raw.toString());
                } catch {
                    return;
                }
                const result = frameSchema.safeParse(parsed);
                if (!result.success) return;
                const frame = result.data as Frame;
                if (frame.type === 'command') void handleCommand(frame);
            });
            ws.on('error', () => {
                // Server may not be running — best-effort metadata only.
            });
            ws.on('close', () => {
                setTimeout(() => {
                    if (isActive) connectInternal();
                }, 2000);
            });
        } catch {
            /* swallow */
        }
    }

    function disconnect(): void {
        isActive = false;
        ws?.close();
        ws = undefined;
    }

    function emitEvent(name: string, payload: unknown): void {
        const event: EventFrame = {
            type: 'event',
            id: newId(),
            projectId: ctx.projectId,
            buildId: ctx.getBuildId(),
            name,
            ts: Date.now(),
            payload,
        };
        send(event);
    }

    return {
        connect,
        disconnect,
        emitEvent,
        get isActive() {
            return isActive;
        },
    };
}
