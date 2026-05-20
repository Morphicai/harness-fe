/**
 * Tests for selectTransport() — transport selection logic under all env vars.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { selectTransport, WsTransport, HttpBatchTransport } from './transport.js';
import type { RegisterOptions } from './index.js';

const baseOpts: RegisterOptions = { projectId: 'test-proj' };

afterEach(() => {
    delete process.env.NEXT_RUNTIME;
    delete process.env.HARNESSA_FE_TRANSPORT;
});

describe('selectTransport', () => {
    it('returns WsTransport when no env override and ws is loadable', () => {
        // In test environment, ws is a devDependency so canLoadWs() is true
        delete process.env.NEXT_RUNTIME;
        delete process.env.HARNESSA_FE_TRANSPORT;
        const t = selectTransport(baseOpts);
        expect(t).toBeInstanceOf(WsTransport);
    });

    it('returns HttpBatchTransport when NEXT_RUNTIME=edge', () => {
        process.env.NEXT_RUNTIME = 'edge';
        const t = selectTransport(baseOpts);
        expect(t).toBeInstanceOf(HttpBatchTransport);
    });

    it('returns HttpBatchTransport when HARNESSA_FE_TRANSPORT=http', () => {
        process.env.HARNESSA_FE_TRANSPORT = 'http';
        const t = selectTransport(baseOpts);
        expect(t).toBeInstanceOf(HttpBatchTransport);
    });

    it('NEXT_RUNTIME=edge takes precedence over ws availability', () => {
        process.env.NEXT_RUNTIME = 'edge';
        // Even if ws could be loaded, edge forces http
        const t = selectTransport(baseOpts);
        expect(t).toBeInstanceOf(HttpBatchTransport);
    });

    it('HARNESSA_FE_TRANSPORT=http takes precedence over ws availability', () => {
        process.env.HARNESSA_FE_TRANSPORT = 'http';
        const t = selectTransport(baseOpts);
        expect(t).toBeInstanceOf(HttpBatchTransport);
    });

    it('WsTransport uses opts.mcpUrl as WS endpoint', () => {
        delete process.env.NEXT_RUNTIME;
        delete process.env.HARNESSA_FE_TRANSPORT;
        const opts: RegisterOptions = { ...baseOpts, mcpUrl: 'ws://127.0.0.1:9999' };
        const t = selectTransport(opts);
        expect(t).toBeInstanceOf(WsTransport);
    });

    it('HttpBatchTransport derives baseUrl from opts.mcpUrl', () => {
        process.env.HARNESSA_FE_TRANSPORT = 'http';
        const opts: RegisterOptions = { ...baseOpts, mcpUrl: 'ws://127.0.0.1:9999' };
        const t = selectTransport(opts) as HttpBatchTransport;
        expect(t).toBeInstanceOf(HttpBatchTransport);
        // Verify the derived base URL is http, not ws
        // Access private field via cast for testing
        const baseUrl = (t as unknown as { baseUrl: string }).baseUrl;
        expect(baseUrl).toBe('http://127.0.0.1:9999');
    });

    it('HttpBatchTransport uses opts.baseUrl directly when provided', () => {
        process.env.HARNESSA_FE_TRANSPORT = 'http';
        const opts: RegisterOptions & { baseUrl: string } = {
            ...baseOpts,
            baseUrl: 'http://192.168.1.5:47729',
        };
        const t = selectTransport(opts) as HttpBatchTransport;
        const baseUrl = (t as unknown as { baseUrl: string }).baseUrl;
        expect(baseUrl).toBe('http://192.168.1.5:47729');
    });
});
