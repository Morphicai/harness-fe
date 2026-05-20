/**
 * @harnessa-fe/node-runtime/auto-edge
 *
 * Side-effect entry point for Edge Runtime bundles. Identical to `auto.ts` but
 * forces HTTP batch transport by setting HARNESSA_FE_TRANSPORT=http before
 * registration — this prevents any attempt to `require('ws')` which would
 * panic the edge bundler.
 *
 * Injected automatically by `withHarnessa()` when the webpack target is
 * 'webworker' (edge runtime chunk).
 *
 * Environment variables read (same as auto.ts):
 *   HARNESSA_FE_PROJECT_ID   — required
 *   HARNESSA_FE_DISPLAY_NAME — optional
 *   HARNESSA_FE_BUILD_ID     — optional
 *   HARNESSA_FE_MCP_URL      — optional; daemon WS URL (ws://… → http://… auto-converted)
 *   NODE_ENV                 — only registers in 'development'
 */

// Force HTTP transport — must happen before importing index.ts
process.env.HARNESSA_FE_TRANSPORT = 'http';

import { register } from './index.js';

const projectId = process.env.HARNESSA_FE_PROJECT_ID;

if (process.env.NODE_ENV === 'development' && projectId) {
    register({
        projectId,
        displayName: process.env.HARNESSA_FE_DISPLAY_NAME,
        buildId: process.env.HARNESSA_FE_BUILD_ID,
        mcpUrl: process.env.HARNESSA_FE_MCP_URL,
    });
}
