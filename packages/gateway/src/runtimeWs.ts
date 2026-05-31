/**
 * Runtime WebSocket front door (`/ws`).
 *
 * The gateway terminates the browser runtime's WebSocket, resolves a
 * write-scope {@link Principal} through the {@link Policy} (Open → local;
 * Governed → a write token), adapts the `ws.WebSocket` to core's
 * {@link PeerSocket}, and hands it to `coreClient.acceptPeer`. core then sees a
 * transport-agnostic peer it can drive and persist from — and, for a write-only
 * principal, denies every read/control capability.
 */

import type { Server as HttpServer, IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import { WebSocket, WebSocketServer } from 'ws';
import type { CoreClient, PeerSocket } from '@harness-fe/core';
import type { Policy } from './policy.js';

/** Adapt a `ws.WebSocket` to core's {@link PeerSocket}. */
class WsPeerSocket implements PeerSocket {
    constructor(private readonly ws: WebSocket) {}
    send(data: string): void {
        try {
            if (this.ws.readyState === WebSocket.OPEN) this.ws.send(data);
        } catch {
            /* swallow — close will follow */
        }
    }
    close(): void {
        try {
            this.ws.close();
        } catch {
            /* swallow */
        }
    }
    get isOpen(): boolean {
        return this.ws.readyState === WebSocket.OPEN;
    }
    onMessage(handler: (data: string) => void): void {
        this.ws.on('message', (raw) => handler(raw.toString()));
    }
    onClose(handler: () => void): void {
        this.ws.on('close', handler);
    }
}

export interface RuntimeWsOptions {
    coreClient: CoreClient;
    policy: Policy;
    /** Path the runtime connects on. Default `/ws`. */
    path?: string;
}

export interface RuntimeWsHandle {
    /** Detach the WS server (does not close the underlying HTTP server). */
    close(): void;
}

/**
 * Attach a runtime WebSocket handler to an existing HTTP server's `upgrade`
 * event for the given path. Other paths' upgrades are left untouched (the MCP
 * HTTP transport does not use WS upgrades).
 */
export function attachRuntimeWs(server: HttpServer, opts: RuntimeWsOptions): RuntimeWsHandle {
    const path = opts.path ?? '/ws';
    const wss = new WebSocketServer({ noServer: true });

    const onUpgrade = (req: IncomingMessage, socket: Duplex, head: Buffer): void => {
        const reqPath = (req.url ?? '').split('?')[0];
        if (reqPath !== path) return; // not ours — leave for other listeners
        const resolved = opts.policy.resolveRuntime(req);
        if (!resolved) {
            socket.write(
                'HTTP/1.1 401 Unauthorized\r\n' +
                    'WWW-Authenticate: Bearer realm="harness-fe"\r\n' +
                    'Content-Length: 0\r\nConnection: close\r\n\r\n',
            );
            socket.destroy();
            return;
        }
        wss.handleUpgrade(req, socket, head, (ws) => {
            opts.coreClient.acceptPeer(new WsPeerSocket(ws), resolved.principal);
        });
    };

    server.on('upgrade', onUpgrade);

    return {
        close() {
            server.off('upgrade', onUpgrade);
            wss.close();
        },
    };
}
