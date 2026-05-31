import { describe, it, expect } from 'vitest';
import { DEFAULT_WS_PORT } from '@harness-fe/protocol';
import { resolveSoloTarget } from './soloTarget.js';

describe('resolveSoloTarget', () => {
    it('loopback + no token → spawn target with explicit port', () => {
        expect(resolveSoloTarget('ws://127.0.0.1:47729/ws', false)).toEqual({ host: '127.0.0.1', port: 47729 });
    });

    it('localhost host is loopback too', () => {
        expect(resolveSoloTarget('ws://localhost:48000/ws', false)).toEqual({ host: 'localhost', port: 48000 });
    });

    it('no port in URL → DEFAULT_WS_PORT', () => {
        expect(resolveSoloTarget('ws://127.0.0.1/ws', false)).toEqual({ host: '127.0.0.1', port: DEFAULT_WS_PORT });
    });

    it('has token → null (team: never auto-spawn)', () => {
        expect(resolveSoloTarget('ws://127.0.0.1:47729/ws', true)).toBeNull();
    });

    it('non-loopback host → null (team: remote gateway owned elsewhere)', () => {
        expect(resolveSoloTarget('ws://10.0.0.5:9000/ws', false)).toBeNull();
    });

    it('unparseable URL → null', () => {
        expect(resolveSoloTarget('not a url', false)).toBeNull();
    });
});
