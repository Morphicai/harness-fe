import { afterEach, describe, expect, it, vi } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { CoreCapabilities } from '@harness-fe/core';
import { createMcpServer } from './mcp.js';
import { pipeTransports } from './mcpProxy.js';

// A real 1x1 PNG; no browser or model provider is needed to test MCP delivery.
const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aNIUAAAAASUVORK5CYII=';
const screenshot = {
    via: 'document', format: 'png', width: 1, height: 1,
    dataUrl: `data:image/png;base64,${png}`,
    notCaptured: [{ tag: 'iframe', selector: '#external' }],
};
const cleanup: Array<() => Promise<void>> = [];

afterEach(async () => {
    await Promise.all(cleanup.splice(0).map((close) => close()));
});

async function connect(proxied = false) {
    const command = vi.fn().mockResolvedValue(screenshot);
    const caps = { command } as unknown as CoreCapabilities;
    const principal = { id: 'local', kind: 'local', displayName: 'local' } as const;
    const server = createMcpServer(caps, principal);
    const client = new Client({ name: 'screenshot-test', version: '1' });
    const [clientTransport, peer] = InMemoryTransport.createLinkedPair();
    let serverTransport = peer;
    if (proxied) {
        const [gatewayFacing, gateway] = InMemoryTransport.createLinkedPair();
        pipeTransports(peer, gatewayFacing);
        await Promise.all([peer.start(), gatewayFacing.start()]);
        cleanup.push(() => peer.close(), () => gatewayFacing.close());
        serverTransport = gateway;
    }
    cleanup.push(() => client.close(), () => server.close());
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    return { client, command, principal };
}

describe('page.screenshot MCP image delivery', () => {
    it.each([false, true])('delivers pixels and capture warnings through the proxy=%s', async (proxied) => {
        const { client, command, principal } = await connect(proxied);
        const result = await client.callTool({
            name: 'page.screenshot',
            arguments: { tabId: 'tab-1', selector: { css: '#card' }, maxWidth: 640 },
        });

        expect(result.isError).not.toBe(true);
        expect(result.content).toEqual([
            { type: 'image', mimeType: 'image/png', data: png },
            { type: 'text', text: JSON.stringify({
                via: 'document', format: 'png', width: 1, height: 1,
                notCaptured: screenshot.notCaptured,
            }, null, 2) },
        ]);
        // A text-only base64 result would silently disable vision and waste tokens.
        expect(JSON.stringify(result.content)).not.toContain('data:image/');
        expect(command).toHaveBeenCalledWith('page.screenshot', {
            selector: { css: '#card' }, format: 'png', maxWidth: 640,
        }, principal, { tabId: 'tab-1' });
        expect(screenshot.dataUrl).toBe(`data:image/png;base64,${png}`);
    });

    it.each(['webp', 'jpeg'])('preserves explicit %s output and uses the encoded MIME type', async (format) => {
        const { client, command } = await connect();
        const data = Buffer.from('encoded image bytes').toString('base64');
        command.mockResolvedValue({ ...screenshot, format, dataUrl: `data:image/${format};base64,${data}` });
        const result = await client.callTool({ name: 'page.screenshot', arguments: { format } });
        expect(result.content).toEqual(expect.arrayContaining([
            { type: 'image', mimeType: `image/${format}`, data },
        ]));
        expect(command.mock.calls[0][1].format).toBe(format);
    });

    it('uses the data URL MIME when the browser falls back to PNG', async () => {
        const { client, command } = await connect();
        command.mockResolvedValue({ ...screenshot, format: 'webp' });
        const result = await client.callTool({ name: 'page.screenshot', arguments: { format: 'webp' } });
        expect(result.content).toEqual(expect.arrayContaining([
            { type: 'image', mimeType: 'image/png', data: png },
            { type: 'text', text: JSON.stringify({
                via: 'document', format: 'png', width: 1, height: 1,
                notCaptured: screenshot.notCaptured,
            }, null, 2) },
        ]));
    });

    it.each([
        null,
        {},
        { dataUrl: 'data:,' },
        { dataUrl: 'data:image/png;base64,' },
        { dataUrl: 'data:image/png;base64,not-base64!' },
        { dataUrl: 'data:image/png;base64,A' },
        { dataUrl: 'data:image/svg+xml;base64,c3Zn' },
    ])('reports invalid runtime output as a tool error: %j', async (value) => {
        const { client, command } = await connect();
        command.mockResolvedValue(value);
        const result = await client.callTool({ name: 'page.screenshot', arguments: {} });
        expect(result.isError).toBe(true);
        expect(result.content).toEqual([
            { type: 'text', text: expect.stringContaining('page.screenshot:') },
        ]);
        expect(JSON.stringify(result.content)).not.toContain('data:image/');
    });

    it('keeps ordinary command results as text', async () => {
        const { client, command } = await connect();
        command.mockResolvedValue({ entries: [], matched: 0 });
        const result = await client.callTool({ name: 'console.tail', arguments: {} });
        expect(result.content).toEqual([
            { type: 'text', text: JSON.stringify({ entries: [], matched: 0 }, null, 2) },
        ]);
    });
});
