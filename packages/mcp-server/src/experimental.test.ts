/**
 * Tests for the experimental-feature gate.
 *
 * Default (no gate var named) → experimental tools fully on. Supplying a gate
 * var name restricts them to machines where that var is set (presence
 * semantics — any non-empty value enables). Covered at three layers:
 *   1. experimentalEnabled() — the predicate
 *   2. createMcpServer() over InMemory transport — registration ↔ listTools
 *   3. createDaemon() over real HTTP — the full option-threading path
 *      (daemon → mcpHttp → createMcpServer)
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { Bridge } from '@harness-fe/daemon';
import { JsonlStore } from '@harness-fe/daemon';
import { createMcpServer, experimentalEnabled } from './mcp.js';
import { createDaemon } from './daemon.js';

const cleanups: Array<() => Promise<void>> = [];
const TRACKED = ['HARNESS_FE_EXPERIMENTAL', 'CUSTOM_EXP_FLAG'];
const saved: Record<string, string | undefined> = {};

beforeEach(() => {
    for (const k of TRACKED) saved[k] = process.env[k];
});

afterEach(async () => {
    for (const k of TRACKED) {
        if (saved[k] === undefined) delete process.env[k];
        else process.env[k] = saved[k];
    }
    while (cleanups.length > 0) await cleanups.pop()!();
});

async function listToolNames(envVar?: string): Promise<string[]> {
    const dir = mkdtempSync(join(tmpdir(), 'harness-exp-'));
    const store = new JsonlStore(dir);
    const bridge = new Bridge({
        port: 0,
        host: '127.0.0.1',
        store,
        taskStore: null,
        autoPurge: { enabled: false },
    });
    await bridge.start();
    const server = createMcpServer(bridge, { experimentalEnvVar: envVar });
    const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 'test-client', version: '0.0.0' }, { capabilities: {} });
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    cleanups.push(async () => {
        await client.close();
        await server.close();
        await bridge.stop();
        await store.close();
    });
    const { tools } = await client.listTools();
    return tools.map((t) => t.name);
}

describe('experimentalEnabled()', () => {
    it('is fully on when no gate var is configured', () => {
        expect(experimentalEnabled()).toBe(true);
        expect(experimentalEnabled('')).toBe(true);
        expect(experimentalEnabled('   ')).toBe(true);
    });

    it('is off when the configured gate var is unset/empty', () => {
        delete process.env.CUSTOM_EXP_FLAG;
        expect(experimentalEnabled('CUSTOM_EXP_FLAG')).toBe(false);
        process.env.CUSTOM_EXP_FLAG = '';
        expect(experimentalEnabled('CUSTOM_EXP_FLAG')).toBe(false);
        process.env.CUSTOM_EXP_FLAG = '   ';
        expect(experimentalEnabled('CUSTOM_EXP_FLAG')).toBe(false);
    });

    it('is on when the configured gate var carries any non-empty value', () => {
        process.env.CUSTOM_EXP_FLAG = '1';
        expect(experimentalEnabled('CUSTOM_EXP_FLAG')).toBe(true);
        process.env.CUSTOM_EXP_FLAG = 'true';
        expect(experimentalEnabled('CUSTOM_EXP_FLAG')).toBe(true);
    });
});

describe('experimental tool gating', () => {
    it('exposes experimental tools by default (no gate configured)', async () => {
        const names = await listToolNames();
        expect(names).toContain('experimental.ping');
    });

    it('hides experimental tools when a gate var is configured but unset', async () => {
        delete process.env.CUSTOM_EXP_FLAG;
        const names = await listToolNames('CUSTOM_EXP_FLAG');
        expect(names).not.toContain('experimental.ping');
    });

    it('exposes them again when the configured gate var is set', async () => {
        process.env.CUSTOM_EXP_FLAG = '1';
        const names = await listToolNames('CUSTOM_EXP_FLAG');
        expect(names).toContain('experimental.ping');
    });
});

// Proves the option actually threads createDaemon → startMcpHttpServer →
// createMcpServer over a real HTTP transport, not just the in-process path.
async function daemonToolNames(experimentalEnvVar?: string): Promise<string[]> {
    const dir = mkdtempSync(join(tmpdir(), 'harness-exp-daemon-'));
    const daemon = createDaemon({ port: 0, host: '127.0.0.1', dataDir: dir, experimentalEnvVar });
    await daemon.start();
    const port = daemon.getBoundPort();
    const transport = new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp`));
    const client = new Client({ name: 'test-client', version: '0.0.0' }, { capabilities: {} });
    await client.connect(transport);
    cleanups.push(async () => {
        await client.close();
        await daemon.stop();
        rmSync(dir, { recursive: true, force: true });
    });
    const { tools } = await client.listTools();
    return tools.map((t) => t.name);
}

describe('experimental tool gating — createDaemon over HTTP', () => {
    it('exposes experimental tools by default through the daemon', async () => {
        const names = await daemonToolNames();
        expect(names).toContain('experimental.ping');
    });

    it('threads the gate var: hidden when unset, shown when set', async () => {
        delete process.env.CUSTOM_EXP_FLAG;
        expect(await daemonToolNames('CUSTOM_EXP_FLAG')).not.toContain('experimental.ping');
        process.env.CUSTOM_EXP_FLAG = '1';
        expect(await daemonToolNames('CUSTOM_EXP_FLAG')).toContain('experimental.ping');
    });
});
