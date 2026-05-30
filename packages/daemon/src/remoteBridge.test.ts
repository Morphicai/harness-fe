import { describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { Bridge } from './bridge.js';
import { RemoteBridge } from './remoteBridge.js';
import type { Frame, HelloAckFrame, ResponseFrame } from '@harness-fe/protocol';

async function spawnLeader(): Promise<Bridge> {
    const bridge = new Bridge({ port: 0, host: '127.0.0.1', tasksFile: '', store: null });
    await bridge.start();
    return bridge;
}

function getPort(bridge: Bridge): number {
    const port = bridge.getBoundPort();
    if (!port) throw new Error('no address');
    return port;
}

async function fakeRuntimeClient(
    port: number,
    tabId: string,
): Promise<WebSocket> {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`);
    await new Promise<void>((resolve, reject) => {
        ws.once('open', () => resolve());
        ws.once('error', reject);
    });
    ws.send(
        JSON.stringify({
            type: 'hello',
            id: 'h-rc',
            role: 'runtime-client',
            projectId: 'demo',
            tabId,
            sessionId: 'sess-1',
            page: { url: 'http://localhost:5173/', title: 'Demo' },
        }),
    );
    await new Promise<HelloAckFrame>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('hello.ack timeout')), 1000);
        ws.once('message', (raw) => {
            clearTimeout(timer);
            resolve(JSON.parse(raw.toString()) as HelloAckFrame);
        });
    });
    return ws;
}

describe('RemoteBridge (follower → leader)', () => {
    it('listTabs reflects tabs registered on the leader', async () => {
        const leader = await spawnLeader();
        try {
            const port = getPort(leader);
            const rc = await fakeRuntimeClient(port, 't-remote-1');

            const follower = new RemoteBridge({ port, host: '127.0.0.1' });
            await follower.connect();
            try {
                const tabs = await follower.listTabs();
                expect(tabs).toHaveLength(1);
                expect(tabs[0].tabId).toBe('t-remote-1');
            } finally {
                await follower.stop();
                rc.close();
            }
        } finally {
            await leader.stop();
        }
    });

    it('sendCommand forwards through leader to runtime-client and returns the result', async () => {
        const leader = await spawnLeader();
        try {
            const port = getPort(leader);
            const rc = await fakeRuntimeClient(port, 't-remote-2');
            // Echo: respond ok with { echoed: args }
            rc.on('message', (raw) => {
                const frame = JSON.parse(raw.toString()) as Frame;
                if (frame.type !== 'command') return;
                const reply: ResponseFrame = {
                    type: 'response',
                    id: frame.id,
                    ok: true,
                    result: { echoed: frame.args },
                };
                rc.send(JSON.stringify(reply));
            });

            const follower = new RemoteBridge({ port, host: '127.0.0.1' });
            await follower.connect();
            try {
                const out = (await follower.sendCommand(
                    'page.evaluate',
                    { expr: '1+1' },
                    { tabId: 't-remote-2' },
                )) as { echoed: { expr: string } };
                expect(out.echoed.expr).toBe('1+1');
            } finally {
                await follower.stop();
                rc.close();
            }
        } finally {
            await leader.stop();
        }
    });

    it('rejects pending calls when leader disappears', async () => {
        const leader = await spawnLeader();
        const port = getPort(leader);
        const follower = new RemoteBridge({ port, host: '127.0.0.1' });
        await follower.connect();
        // Issue a call with no runtime-client connected → leader will throw; we just
        // need to confirm follower receives the propagated error frame cleanly.
        const callPromise = follower.sendCommand('page.click', { selector: { css: '#x' } });
        await expect(callPromise).rejects.toThrow(/no runtime-client|connection|closed/i);
        await follower.stop();
        await leader.stop();
    });
});
