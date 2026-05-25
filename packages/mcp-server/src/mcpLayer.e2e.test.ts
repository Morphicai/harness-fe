/**
 * End-to-end tests for the MCP tool layer added in the multi-tab observability
 * sweep. Uses InMemoryTransport.createLinkedPair() to run a real McpServer +
 * Client in-process — exercising the registerTool → handler → bridge.sendCommand
 * (or store call) → response round-trip without stdio overhead.
 *
 * The bridge has a real JsonlStore on tmpdir + a real `ws` runtime-client
 * peer so visitor.timeline and the *.tail tools have something to read.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { Bridge } from './bridge.js';
import { JsonlStore } from './store/index.js';
import { createMcpServer } from './mcp.js';
import type {
    EventFrame,
    HelloAckFrame,
    NetworkEntry,
    StorageEntry,
    WsEntry,
} from '@harness-fe/protocol';

interface TestEnv {
    bridge: Bridge;
    store: JsonlStore;
    dir: string;
    port: number;
    client: Client;
    teardown: () => Promise<void>;
}

const envs: TestEnv[] = [];

async function setup(): Promise<TestEnv> {
    const dir = mkdtempSync(join(tmpdir(), 'harness-mcp-e2e-'));
    const store = new JsonlStore(dir);
    const bridge = new Bridge({
        port: 0,
        host: '127.0.0.1',
        store,
        taskStore: null,
        autoPurge: { enabled: false },
    });
    await bridge.start();
    const port = bridge.getBoundPort();
    if (!port) throw new Error('no port');

    const server = createMcpServer(bridge);
    const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 'test-client', version: '0.0.0' }, { capabilities: {} });
    await server.connect(serverTransport);
    await client.connect(clientTransport);

    const env: TestEnv = {
        bridge,
        store,
        dir,
        port,
        client,
        teardown: async () => {
            await client.close();
            await server.close();
            await bridge.stop();
            store.close();
            rmSync(dir, { recursive: true, force: true });
        },
    };
    envs.push(env);
    return env;
}

afterEach(async () => {
    while (envs.length > 0) {
        const env = envs.pop()!;
        await env.teardown();
    }
});

async function connectRuntime(
    port: number,
    opts: { tabId: string; projectId: string; sessionId: string; visitorId?: string },
): Promise<WebSocket> {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`);
    await new Promise<void>((resolve, reject) => {
        ws.once('open', () => resolve());
        ws.once('error', reject);
    });
    ws.send(JSON.stringify({
        type: 'hello',
        id: 'h1',
        role: 'runtime-client',
        projectId: opts.projectId,
        tabId: opts.tabId,
        sessionId: opts.sessionId,
        visitorId: opts.visitorId,
        page: { url: 'http://localhost:5173/', title: 'Demo' },
    }));
    await new Promise<HelloAckFrame>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('hello.ack timeout')), 1000);
        ws.once('message', (raw) => {
            clearTimeout(timer);
            resolve(JSON.parse(raw.toString()) as HelloAckFrame);
        });
    });
    return ws;
}

function emit(ws: WebSocket, name: string, payload: unknown, tabId: string): void {
    ws.send(JSON.stringify({
        type: 'event',
        id: `evt-${randomUUID()}`,
        tabId,
        name,
        ts: Date.now(),
        payload,
    } satisfies EventFrame));
}

function parseToolText(result: { content: Array<{ type: string; text?: string }> }): unknown {
    const text = result.content?.[0]?.text ?? '';
    try { return JSON.parse(text); } catch { return text; }
}

describe('MCP E2E — visitor.timeline tool round-trip', () => {
    it('client.callTool("visitor.timeline") returns merged events across two tabs', async () => {
        const env = await setup();
        const projectId = 'tanka';
        const visitorId = `v-${randomUUID()}`;
        const sessA = randomUUID();
        const sessB = randomUUID();
        const tabA = 't-mcp-a';
        const tabB = 't-mcp-b';
        const wsA = await connectRuntime(env.port, { tabId: tabA, projectId, sessionId: sessA, visitorId });
        const wsB = await connectRuntime(env.port, { tabId: tabB, projectId, sessionId: sessB, visitorId });

        emit(wsA, 'ws', { ts: Date.now(), id: 'w1', phase: 'recv', url: 'wss://x/', payload: { type: 'kick' } } satisfies WsEntry, tabA);
        emit(wsB, 'storage', { ts: Date.now() + 5, op: 'remove', which: 'local', key: 'token', initiator: { stack: 'at clearToken' } } satisfies StorageEntry, tabB);
        emit(wsB, 'network', { ts: Date.now() + 10, id: 'r1', phase: 'req', method: 'POST', url: 'https://api.test/sync' } satisfies NetworkEntry, tabB);

        // Let the daemon ingest + flush.
        await new Promise((r) => setTimeout(r, 60));
        await env.store.flush();
        wsA.close();
        wsB.close();

        const result = await env.client.callTool({
            name: 'visitor.timeline',
            arguments: { visitorId },
        });
        const body = parseToolText(result as { content: Array<{ type: string; text?: string }> }) as {
            visitorId: string;
            sessionCount: number;
            eventCount: number;
            events: Array<{ t: string; tab?: string }>;
        };
        expect(body.visitorId).toBe(visitorId);
        expect(body.sessionCount).toBe(2);
        expect(body.events.length).toBeGreaterThanOrEqual(3);
        const types = new Set(body.events.map((e) => e.t));
        expect(types.has('ws')).toBe(true);
        expect(types.has('storage')).toBe(true);
        expect(types.has('network')).toBe(true);
        const tabs = new Set(body.events.map((e) => e.tab));
        expect(tabs.has(tabA)).toBe(true);
        expect(tabs.has(tabB)).toBe(true);
    });

    it('visitor.timeline with unknown visitorId surfaces an error via isError', async () => {
        const env = await setup();
        const result = await env.client.callTool({
            name: 'visitor.timeline',
            arguments: { visitorId: 'nonexistent' },
        }) as { isError?: boolean; content: Array<{ text?: string }> };
        expect(result.isError).toBe(true);
        expect(result.content?.[0]?.text ?? '').toContain('visitor not found');
    });
});

describe('MCP E2E — tools are listable and discoverable', () => {
    it('listTools includes the new tools added in this sweep', async () => {
        const env = await setup();
        const { tools } = await env.client.listTools();
        const names = new Set(tools.map((t) => t.name));
        // Every new tool we added should show up on the wire.
        for (const name of [
            'ws.tail',
            'storage.tail',
            'network.get',
            'ws.get',
            'network.wait_for',
            'network.wait_for_idle',
            'visitor.timeline',
        ]) {
            expect(names.has(name)).toBe(true);
        }
    });

    it('network.tail tool advertises the new filter / match / urlContains / method / statusCode params', async () => {
        const env = await setup();
        const { tools } = await env.client.listTools();
        const networkTail = tools.find((t) => t.name === 'network.tail');
        expect(networkTail).toBeDefined();
        const props = (networkTail!.inputSchema as { properties?: Record<string, unknown> }).properties ?? {};
        for (const key of ['filter', 'match', 'urlContains', 'method', 'statusCode']) {
            expect(props[key]).toBeDefined();
        }
    });
});

describe('MCP E2E — capability surfacing on tool descriptions', () => {
    it('session.tail description cross-references visitor.timeline', async () => {
        const env = await setup();
        const { tools } = await env.client.listTools();
        const sessionTail = tools.find((t) => t.name === 'session.tail');
        expect(sessionTail).toBeDefined();
        expect(sessionTail!.description ?? '').toContain('visitor.timeline');
    });

    it('console/network/errors/ws/storage tail tools cross-reference session.tail', async () => {
        const env = await setup();
        const { tools } = await env.client.listTools();
        for (const name of ['console.tail', 'network.tail', 'errors.tail', 'ws.tail', 'storage.tail']) {
            const t = tools.find((x) => x.name === name);
            expect(t, `${name} should exist`).toBeDefined();
            expect(t!.description ?? '', `${name} description should reference session.tail`).toContain('session.tail');
        }
    });
});
