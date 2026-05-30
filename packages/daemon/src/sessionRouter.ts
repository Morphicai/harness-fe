/**
 * SessionRouter — registry of connected peers (vite-plugin + runtime-client).
 *
 * - Project: 1 vite-plugin per project (uniqued by projectId)
 * - Tab    : N runtime-clients per project (each browser tab is one)
 *
 * Active tab heuristic: most recently active (last command or last event).
 * Caller can override via explicit tabId on every command.
 */

import type {
    PeerRole,
    TabInfo,
} from '@harness-fe/protocol';
import { canSee, type Principal } from './identity.js';

export interface PeerSession {
    role: PeerRole;
    projectId: string;
    tabId?: string;
    /** Caller identity behind this connection (4.0 · P1). Defaults to `local`. */
    principal?: Principal;
    /** Runtime-client only: identifies the page load (sessionId) this connection belongs to. */
    sessionId?: string;
    /** Runtime-client only: stable per-browser visitor identifier. */
    visitorId?: string;
    /** App-supplied user identifier propagated from HarnessScript userId prop. */
    userId?: string;
    /** Opaque identifier for the underlying connection. */
    connectionId: string;
    lastActive: number;
    page?: { url?: string; title?: string; userAgent?: string };
}

export class SessionRouter {
    private peers = new Map<string, PeerSession>(); // key = connectionId
    private mostRecentTabId?: string;

    register(session: Omit<PeerSession, 'lastActive'>): PeerSession {
        const stored: PeerSession = { ...session, lastActive: Date.now() };
        this.peers.set(session.connectionId, stored);
        if (session.role === 'runtime-client' && session.tabId) {
            this.mostRecentTabId = session.tabId;
        }
        return stored;
    }

    unregister(connectionId: string): void {
        const peer = this.peers.get(connectionId);
        this.peers.delete(connectionId);
        if (peer?.tabId && this.mostRecentTabId === peer.tabId) {
            this.mostRecentTabId = this.findFallbackTab()?.tabId;
        }
    }

    touch(connectionId: string): void {
        const peer = this.peers.get(connectionId);
        if (!peer) return;
        peer.lastActive = Date.now();
        if (peer.role === 'runtime-client' && peer.tabId) {
            this.mostRecentTabId = peer.tabId;
        }
    }

    getByConnectionId(connectionId: string): PeerSession | undefined {
        return this.peers.get(connectionId);
    }

    findVitePlugin(projectId?: string): PeerSession | undefined {
        const candidates = [...this.peers.values()].filter(
            (p) => p.role === 'vite-plugin' || p.role === 'webpack-plugin',
        );
        if (!candidates.length) return undefined;
        if (projectId) return candidates.find((c) => c.projectId === projectId);
        // No projectId filter — return the most recent.
        return candidates.sort((a, b) => b.lastActive - a.lastActive)[0];
    }

    /**
     * Resolve the target tab for a command (4.0 · A — command-target scoping).
     *
     * When `principal` is supplied, candidate tabs are restricted to ones the
     * caller may drive (`canSee` against the tab's owning principal): `local`
     * drives anything (zero behaviour change for solo dev), unowned tabs are
     * drivable by all, otherwise only the tab's creator. Omitting `principal`
     * preserves the original global behaviour.
     */
    findTab(tabId?: string, principal?: Principal): PeerSession | undefined {
        if (tabId) {
            for (const p of this.peers.values()) {
                if (p.role === 'runtime-client' && p.tabId === tabId) {
                    // Explicit tabId still can't target someone else's tab.
                    if (principal && !canSee(principal, p.principal?.id)) return undefined;
                    return p;
                }
            }
            return undefined;
        }
        // No tabId: most-recent among the tabs the caller is allowed to drive.
        const visible = [...this.peers.values()]
            .filter(
                (p): p is PeerSession & { tabId: string } =>
                    p.role === 'runtime-client' &&
                    !!p.tabId &&
                    (!principal || canSee(principal, p.principal?.id)),
            )
            .sort((a, b) => b.lastActive - a.lastActive);
        if (this.mostRecentTabId) {
            const mr = visible.find((p) => p.tabId === this.mostRecentTabId);
            if (mr) return mr;
        }
        return visible[0];
    }

    private findFallbackTab(): PeerSession | undefined {
        const tabs = [...this.peers.values()]
            .filter((p) => p.role === 'runtime-client' && p.tabId)
            .sort((a, b) => b.lastActive - a.lastActive);
        return tabs[0];
    }

    listTabs(): TabInfo[] {
        return [...this.peers.values()]
            .filter((p): p is PeerSession & { tabId: string } => p.role === 'runtime-client' && !!p.tabId)
            .map((p) => ({
                tabId: p.tabId,
                projectId: p.projectId,
                url: p.page?.url,
                title: p.page?.title,
                userAgent: p.page?.userAgent,
                connectedAt: p.lastActive,
            }));
    }

    listProjects(): string[] {
        const ids = new Set<string>();
        for (const p of this.peers.values()) {
            if (p.role === 'vite-plugin' || p.role === 'webpack-plugin') ids.add(p.projectId);
        }
        return [...ids];
    }
}
