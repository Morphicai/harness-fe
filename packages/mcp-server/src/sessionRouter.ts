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
} from '@morphixai/harnessa-fe.protocol';

export interface PeerSession {
    role: PeerRole;
    projectId: string;
    tabId?: string;
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
        const candidates = [...this.peers.values()].filter((p) => p.role === 'vite-plugin');
        if (!candidates.length) return undefined;
        if (projectId) return candidates.find((c) => c.projectId === projectId);
        // No projectId filter — return the most recent.
        return candidates.sort((a, b) => b.lastActive - a.lastActive)[0];
    }

    findTab(tabId?: string): PeerSession | undefined {
        if (tabId) {
            for (const p of this.peers.values()) {
                if (p.role === 'runtime-client' && p.tabId === tabId) return p;
            }
            return undefined;
        }
        if (this.mostRecentTabId) {
            return this.findTab(this.mostRecentTabId);
        }
        return this.findFallbackTab();
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
            if (p.role === 'vite-plugin') ids.add(p.projectId);
        }
        return [...ids];
    }
}
