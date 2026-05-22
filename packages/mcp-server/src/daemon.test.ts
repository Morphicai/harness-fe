import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { IncomingMessage } from 'node:http';
import { createDaemon } from './daemon.js';

const cleanups: Array<() => Promise<void> | void> = [];

afterEach(async () => {
    while (cleanups.length) {
        const fn = cleanups.shift();
        if (fn) await fn();
    }
});

function freshDataDir(): string {
    const dir = mkdtempSync(join(tmpdir(), 'harness-daemon-test-'));
    cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
    return dir;
}

describe('createDaemon', () => {
    it('boots a bridge on an ephemeral port and serves /mcp', async () => {
        const daemon = createDaemon({
            port: 0,
            host: '127.0.0.1',
            dataDir: freshDataDir(),
        });
        cleanups.push(() => daemon.stop());

        await daemon.start();
        const port = daemon.getBoundPort();
        expect(port).toBeGreaterThan(0);
        expect(daemon.mcpPath).toBe('/mcp');

        // Anything not /mcp falls through to the bridge's 404.
        const res = await fetch(`http://127.0.0.1:${port}/nothing-here`);
        expect(res.status).toBe(404);

        // /mcp is mounted (returns something other than the bridge 404 body).
        const mcp = await fetch(`http://127.0.0.1:${port}/mcp`);
        const body = await mcp.text();
        expect(body).not.toBe('Not Found');
    });

    it('start is idempotent and stop is idempotent', async () => {
        const daemon = createDaemon({
            port: 0,
            host: '127.0.0.1',
            dataDir: freshDataDir(),
        });
        cleanups.push(() => daemon.stop());

        await daemon.start();
        await daemon.start(); // second call no-ops
        const port = daemon.getBoundPort();
        expect(port).toBeGreaterThan(0);

        await daemon.stop();
        await daemon.stop(); // second call no-ops
    });

    it('invokes a custom authorize on every request and rejects on false', async () => {
        const authorize = vi.fn<(req: IncomingMessage) => boolean>(
            (req) => req.headers.authorization === 'Bearer good',
        );

        const daemon = createDaemon({
            port: 0,
            host: '127.0.0.1',
            dataDir: freshDataDir(),
            authorize,
        });
        cleanups.push(() => daemon.stop());
        await daemon.start();

        const port = daemon.getBoundPort()!;
        const denied = await fetch(`http://127.0.0.1:${port}/mcp`);
        expect(denied.status).toBe(401);

        const allowed = await fetch(`http://127.0.0.1:${port}/mcp`, {
            headers: { authorization: 'Bearer good' },
        });
        expect(allowed.status).not.toBe(401);

        // Auth was consulted at least twice (denied + allowed). Other internal
        // routes may also have hit it during startup; we don't assert an
        // exact count — only that the predicate is on the hot path.
        expect(authorize.mock.calls.length).toBeGreaterThanOrEqual(2);
    });

    it('exposes the underlying Bridge as a tested escape hatch', async () => {
        const daemon = createDaemon({
            port: 0,
            host: '127.0.0.1',
            dataDir: freshDataDir(),
        });
        cleanups.push(() => daemon.stop());
        await daemon.start();

        expect(daemon.bridge).toBeDefined();
        expect(daemon.bridge.getBoundPort()).toBe(daemon.getBoundPort());
    });

    it('honours a custom mcpPath', async () => {
        const daemon = createDaemon({
            port: 0,
            host: '127.0.0.1',
            dataDir: freshDataDir(),
            mcpPath: '/custom-mcp',
        });
        cleanups.push(() => daemon.stop());
        await daemon.start();
        expect(daemon.mcpPath).toBe('/custom-mcp');

        const port = daemon.getBoundPort()!;
        const res = await fetch(`http://127.0.0.1:${port}/custom-mcp`);
        // 404 would mean the path wasn't mounted (bridge default). Anything
        // else means the MCP transport responded.
        expect(await res.text()).not.toBe('Not Found');
    });
});
