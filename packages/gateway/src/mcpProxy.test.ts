import { describe, it, expect } from 'vitest';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js';
import { pipeTransports } from './mcpProxy.js';

const tick = () => new Promise((r) => setTimeout(r, 5));

describe('pipeTransports', () => {
    it('forwards frames in both directions, untouched', async () => {
        // client ↔ a   (a is the proxy's "agent-facing" side)
        // b ↔ server   (b is the proxy's "gateway-facing" side)
        const [client, a] = InMemoryTransport.createLinkedPair();
        const [b, server] = InMemoryTransport.createLinkedPair();
        pipeTransports(a, b);

        const atServer: JSONRPCMessage[] = [];
        const atClient: JSONRPCMessage[] = [];
        server.onmessage = (m) => atServer.push(m);
        client.onmessage = (m) => atClient.push(m);

        await Promise.all([client.start(), a.start(), b.start(), server.start()]);

        // agent → gateway
        const request: JSONRPCMessage = { jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} };
        await client.send(request);
        await tick();
        expect(atServer).toEqual([request]);

        // gateway → agent
        const response: JSONRPCMessage = { jsonrpc: '2.0', id: 1, result: { tools: [] } };
        await server.send(response);
        await tick();
        expect(atClient).toEqual([response]);
    });
});
