/**
 * @harness-fe/node-runtime/auto-edge
 *
 * Side-effect entry point for Edge Runtime bundles. Identical to `auto.ts` but
 * forces HTTP batch transport by setting HARNESS_FE_TRANSPORT=http before
 * registration — this prevents any attempt to `require('ws')` which would
 * panic the edge bundler.
 *
 * Injected automatically by `withHarness()` when the webpack target is
 * 'webworker' (edge runtime chunk).
 *
 * Environment variables read (same as auto.ts):
 *   HARNESS_FE_PROJECT_ID   — required
 *   HARNESS_FE_DISPLAY_NAME — optional
 *   HARNESS_FE_BUILD_ID     — optional
 *   HARNESS_FE_MCP_URL      — optional; daemon WS URL (ws://… → http://… auto-converted)
 */

// Force HTTP transport — must happen before importing index.ts
process.env.HARNESS_FE_TRANSPORT = 'http';

import { register } from './index.js';

const projectId = process.env.HARNESS_FE_PROJECT_ID;

if (projectId) {
    register({
        projectId,
        displayName: process.env.HARNESS_FE_DISPLAY_NAME,
        buildId: process.env.HARNESS_FE_BUILD_ID,
        mcpUrl: process.env.HARNESS_FE_MCP_URL,
    });
}
