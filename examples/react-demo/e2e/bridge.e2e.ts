/**
 * Node-side end-to-end smoke: boots the MCP bridge, simulates a runtime-client
 * via raw WebSocket, and verifies the round-trip command/response flow that
 * Claude would experience. Not a Vitest spec — run via:
 *
 *   pnpm e2e
 *
 * This is the closest thing we can do without spawning a real browser.
 */

import { setTimeout as sleep } from 'node:timers/promises';
import { WebSocket } from 'ws';
import { Bridge } from '@harness-fe/mcp-server';
import {
    COMMAND,
    PROTOCOL_VERSION,
    type CommandFrame,
    type HelloAckFrame,
    type ResponseFrame,
} from '@harness-fe/protocol';

async function run() {
    const bridge = new Bridge({ port: 0, host: '127.0.0.1' });
    await bridge.start();
    // @ts-expect-error access internal wss for the assigned port
    const port = bridge.wss.address().port as number;
    console.log(`[e2e] bridge listening on 127.0.0.1:${port}`);

    // Simulate a runtime-client (what the real browser will be doing).
    const ws = new WebSocket(`ws://127.0.0.1:${port}`);
    await new Promise<void>((resolve, reject) => {
        ws.once('open', () => resolve());
        ws.once('error', reject);
    });
    ws.send(
        JSON.stringify({
            type: 'hello',
            id: 'h1',
            role: 'runtime-client',
            projectId: 'react-demo',
            tabId: 'sim-tab-1',
            page: { url: 'http://localhost:5173/', title: 'demo' },
        }),
    );
    const ack = await new Promise<HelloAckFrame>((resolve) => {
        ws.once('message', (raw) => resolve(JSON.parse(raw.toString())));
    });
    console.log('[e2e] hello.ack', ack);
    if (ack.serverVersion !== PROTOCOL_VERSION) {
        throw new Error(`serverVersion mismatch: ${ack.serverVersion}`);
    }

    // Stub command handler: respond to every command with a fake result.
    ws.on('message', (raw) => {
        const frame = JSON.parse(raw.toString()) as CommandFrame;
        if (frame.type !== 'command') return;
        const resp: ResponseFrame = {
            type: 'response',
            id: frame.id,
            ok: true,
            result: { simulated: true, command: frame.command, args: frame.args },
        };
        ws.send(JSON.stringify(resp));
    });

    // From the Claude-side: send a command through the bridge and assert
    // we get the simulated response back.
    const result = await bridge.sendCommand(COMMAND.PAGE_CLICK, {
        selector: { component: 'IncrementBtn' },
    });
    console.log('[e2e] sendCommand result', result);
    if (!result || typeof result !== 'object' || (result as { simulated?: boolean }).simulated !== true) {
        throw new Error(`unexpected result: ${JSON.stringify(result)}`);
    }

    // Verify tab.list returns our simulated tab.
    const tabs = bridge.router.listTabs();
    console.log('[e2e] tab.list', tabs);
    if (tabs.length !== 1 || tabs[0].tabId !== 'sim-tab-1') {
        throw new Error(`expected 1 tab "sim-tab-1", got ${JSON.stringify(tabs)}`);
    }

    // Simulate an event from the runtime-client and verify the listener fires.
    let eventReceived = false;
    bridge.onEvent((e) => {
        if (e.name === 'console') eventReceived = true;
    });
    ws.send(
        JSON.stringify({
            type: 'event',
            id: 'e1',
            tabId: 'sim-tab-1',
            projectId: 'react-demo',
            name: 'console',
            ts: Date.now(),
            payload: { level: 'log', args: ['hello from sim'] },
        }),
    );
    await sleep(50);
    if (!eventReceived) throw new Error('event was not fanned out');
    console.log('[e2e] event fan-out ok');

    ws.close();
    await bridge.stop();
    console.log('[e2e] ALL PASS ✓');
}

run().catch((err) => {
    console.error('[e2e] FAIL', err);
    process.exit(1);
});
