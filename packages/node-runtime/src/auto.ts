/**
 * @harnessa-fe/node-runtime/auto
 *
 * Side-effect entry point. Importing this module calls `register()` using
 * configuration from environment variables. Used by `withHarnessa()` (the
 * Next.js config wrapper) which injects `import '@harnessa-fe/node-runtime/auto'`
 * into the server bundle automatically.
 *
 * Environment variables read:
 *   HARNESSA_FE_PROJECT_ID   — required; project identifier
 *   HARNESSA_FE_DISPLAY_NAME — optional; human-readable name
 *   HARNESSA_FE_BUILD_ID     — optional; build artifact id (e.g. git SHA)
 *   HARNESSA_FE_MCP_URL      — optional; daemon WS URL (default ws://127.0.0.1:47729)
 *   HARNESSA_FE_NODE_CONSOLE — set to '1' to enable console capture
 *   NODE_ENV                 — only registers in 'development'
 */

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
