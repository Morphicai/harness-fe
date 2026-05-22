/**
 * @harnessa-fe/webpack — native webpack plugin for Harnessa-FE.
 *
 * Usage:
 *   const { harnessaFE } = require('@harnessa-fe/webpack')
 *   // or
 *   import { harnessaFE } from '@harnessa-fe/webpack'
 *
 *   module.exports = { plugins: [harnessaFE()] }
 *
 * Unlike previous versions (which were thin re-exports of
 * @harnessa-fe/unplugin/webpack), this package implements a native webpack
 * plugin that is compatible with thread-loader. See plugin.ts for the why.
 */

export { harnessaFE, HarnessaFEWebpackPlugin } from './plugin.js';
export type { HarnessaFEOptions } from '@harnessa-fe/unplugin';

// Re-export transform utilities for direct usage (preserves the previous
// public surface of @harnessa-fe/webpack@2.x).
export {
    transformJsx,
    type ComponentMap,
    type ComponentLocation,
    type TransformResult,
} from '@harnessa-fe/unplugin';

import { harnessaFE } from './plugin.js';
export default harnessaFE;
