/**
 * Test-only helpers. Excluded from the build (see tsconfig `exclude`) — vitest
 * imports it directly, tsc never emits it.
 */

import type { PeerSocket } from './bridge.js';

/**
 * In-memory {@link PeerSocket} for driving the bridge without a real WebSocket.
 * Tests push inbound frames with {@link receive} and assert on {@link sent}.
 */
export class FakePeerSocket implements PeerSocket {
    /** Raw JSON strings the bridge sent to this peer. */
    readonly sent: string[] = [];
    isOpen = true;
    private msgHandler?: (data: string) => void;
    private closeHandler?: () => void;

    send(data: string): void {
        if (this.isOpen) this.sent.push(data);
    }

    close(): void {
        if (!this.isOpen) return;
        this.isOpen = false;
        this.closeHandler?.();
    }

    onMessage(handler: (data: string) => void): void {
        this.msgHandler = handler;
    }

    onClose(handler: () => void): void {
        this.closeHandler = handler;
    }

    // ── test driving ──────────────────────────────────────────────────────────

    /** Simulate an inbound frame from the peer. */
    receive(frame: unknown): void {
        const raw = typeof frame === 'string' ? frame : JSON.stringify(frame);
        this.msgHandler?.(raw);
    }

    /** All frames the bridge sent, parsed. */
    sentFrames(): any[] {
        return this.sent.map((s) => JSON.parse(s));
    }

    /** The most recent frame the bridge sent, parsed (or undefined). */
    lastFrame(): any {
        const frames = this.sentFrames();
        return frames[frames.length - 1];
    }

    /** Sent frames of a given `type`. */
    framesOfType(type: string): any[] {
        return this.sentFrames().filter((f) => f && f.type === type);
    }
}
