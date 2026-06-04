/**
 * @harness-fe/node-runtime/auto
 *
 * Side-effect entry point. Importing this module calls `register()` using
 * configuration from environment variables. Used by `withHarness()` (the
 * Next.js config wrapper) which injects `import '@harness-fe/node-runtime/auto'`
 * into the server bundle automatically.
 *
 * Environment variables read:
 *   HARNESS_FE_PROJECT_ID   — required; project identifier
 *   HARNESS_FE_DISPLAY_NAME — optional; human-readable name
 *   HARNESS_FE_BUILD_ID     — optional; build artifact id (e.g. git SHA)
 *   HARNESS_FE_MCP_URL      — optional; daemon WS URL (default ws://127.0.0.1:47729)
 *   HARNESS_FE_TOKEN        — optional; appended to mcpUrl as ?token= when set
 *                              (use this when the daemon runs in LAN mode)
 *   HARNESS_FE_NODE_CONSOLE — set to '1' to enable console capture
 */

import { register } from './index.js';

const projectId = process.env.HARNESS_FE_PROJECT_ID;

function withToken(url: string | undefined, token: string | undefined): string | undefined {
    if (!url || !token) return url;
    if (/[?&]token=/.test(url)) return url;
    const sep = url.includes('?') ? '&' : '?';
    return `${url}${sep}token=${encodeURIComponent(token)}`;
}

if (projectId) {
    register({
        projectId,
        displayName: process.env.HARNESS_FE_DISPLAY_NAME,
        buildId: process.env.HARNESS_FE_BUILD_ID,
        mcpUrl: withToken(process.env.HARNESS_FE_MCP_URL, process.env.HARNESS_FE_TOKEN),
    });
}
