/**
 * CoreClient — the interface the gateway depends on. It deliberately hides
 * whether core runs **in-process** (direct method calls + direct socket
 * injection, the only mode today) or **remote** (a future variant that forwards
 * capability calls and proxied peer frames over WS to a core on another
 * machine). The gateway holds a `CoreClient` and never reaches past it.
 *
 * Surface:
 *   - lifecycle (`start` / `stop`),
 *   - runtime/agent/dashboard peer ingestion (`acceptPeer`) + HTTP-batch ingest,
 *   - live event subscription (`onEvent`),
 *   - the capability API (`capabilities`) for `/mcp` and `/console`.
 */

import type { HttpBatch } from '@harness-fe/protocol';
import { Bridge, type BridgeOptions, type EventListener, type PeerSocket } from './bridge.js';
import { LOCAL_PRINCIPAL, type Principal } from './identity.js';
import { CoreCapabilities } from './capability/index.js';

export interface CoreClient {
    /** The capability API — scope/visibility-enforced operations. */
    readonly capabilities: CoreCapabilities;
    /** Begin lifecycle (auto-purge timer). */
    start(): Promise<void>;
    /** Stop lifecycle and close all peer sockets. */
    stop(): Promise<void>;
    /**
     * Accept a runtime / dashboard / (proxied) agent peer. The gateway resolves
     * the caller's {@link Principal} and adapts its transport to
     * {@link PeerSocket} before calling this.
     */
    acceptPeer(socket: PeerSocket, principal?: Principal): void;
    /** Ingest an HTTP-batch (Edge Runtime) hello + events sequence. */
    handleHttpBatch(hello: HttpBatch['hello'], events: HttpBatch['events']): void;
    /** Subscribe to live event frames (returns an unsubscribe fn). */
    onEvent(listener: EventListener): () => void;
}

/**
 * In-process CoreClient: wraps a single {@link Bridge} and a
 * {@link CoreCapabilities} bound to it. Capability calls and peer injection are
 * direct method calls — no serialization, no network.
 */
export class InProcessCoreClient implements CoreClient {
    /** The underlying bridge. Exposed for advanced wiring + tests. */
    readonly bridge: Bridge;
    readonly capabilities: CoreCapabilities;

    constructor(opts: BridgeOptions = {}) {
        this.bridge = new Bridge(opts);
        this.capabilities = new CoreCapabilities(this.bridge);
    }

    start(): Promise<void> {
        return this.bridge.start();
    }

    stop(): Promise<void> {
        return this.bridge.stop();
    }

    acceptPeer(socket: PeerSocket, principal: Principal = LOCAL_PRINCIPAL): void {
        this.bridge.acceptPeer(socket, principal);
    }

    handleHttpBatch(hello: HttpBatch['hello'], events: HttpBatch['events']): void {
        this.bridge.handleHttpBatch(hello, events);
    }

    onEvent(listener: EventListener): () => void {
        return this.bridge.onEvent(listener);
    }
}

/** Create an in-process CoreClient. */
export function createCoreClient(opts: BridgeOptions = {}): CoreClient {
    return new InProcessCoreClient(opts);
}
