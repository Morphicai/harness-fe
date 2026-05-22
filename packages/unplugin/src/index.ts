/**
 * @harness-fe/unplugin — unified build plugin.
 *
 * Usage:
 *   import { harnessFE } from '@harness-fe/unplugin/vite'
 *   import { harnessFE } from '@harness-fe/unplugin/rspack'
 *
 * Webpack: use @harness-fe/webpack (a native plugin — see that package).
 *
 * Or import the raw unplugin for custom integrations:
 *   import { unplugin, unpluginFactory } from '@harness-fe/unplugin'
 */

export { unplugin, unpluginFactory, type HarnessFEOptions } from './core.js';
export { transformJsx, type ComponentMap, type ComponentLocation, type TransformResult } from './transform.js';
export {
    transformVueSFC,
    transformVueTemplate,
    resolveVueComponentName,
    getTemplateLineOffset,
    createVueTransformStats,
    formatVueTransformReport,
    type VueTransformOptions,
    type VueTransformResult,
    type VueTransformStats,
} from './vue-transform.js';

// Internal building blocks — re-exported for downstream native plugins (e.g.
// @harness-fe/webpack) that cannot use the unplugin adapter directly.
export { createMcpClient } from './internal/mcp-client.js';
export { installNodeLogCapture } from './internal/log-capture.js';
export { createBuildIdentity, appendTokenQuery } from './internal/buildIdentity.js';
export type { McpClient, McpClientContext, PeerRole } from './internal/types.js';
export type { BuildIdentity, BuildIdentityOptions } from './internal/buildIdentity.js';
