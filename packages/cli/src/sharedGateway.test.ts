import { describe, it, expect, afterEach } from 'vitest';
import { createCoreClient, type CoreClient } from '@harness-fe/core';
import { createGateway, Policy, type GatewayHandle } from '@harness-fe/gateway';
import { ensureSharedGateway } from './sharedGateway.js';

// Reuse path only — no subprocess. We stand up a real in-process Open gateway on
// an ephemeral port, then assert ensureSharedGateway detects it via the probe
// endpoint and reuses it (reused:true) WITHOUT spawning anything. The spawn path
// is covered by the dist-gated integration test (cli.e2e.test.ts).
describe('ensureSharedGateway — reuse', () => {
    let core: CoreClient | undefined;
    let gw: GatewayHandle | undefined;

    afterEach(async () => {
        if (gw) await gw.close();
        if (core) await core.stop();
        core = undefined;
        gw = undefined;
    });

    it('detects and reuses an already-running harness gateway (no spawn)', async () => {
        core = createCoreClient({ store: null, taskStore: null, autoPurge: { enabled: false } });
        await core.start();
        gw = createGateway({ coreClient: core, policy: new Policy({ mode: 'open' }) });
        const port = await gw.listen(0);

        const handle = await ensureSharedGateway({ port });
        expect(handle).toEqual({ baseUrl: `http://127.0.0.1:${port}`, reused: true });
    });
});
