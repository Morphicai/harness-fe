/**
 * @harness-fe/webpack — native webpack plugin for Harness-FE.
 *
 * Usage:
 *   const { harnessFE } = require('@harness-fe/webpack')
 *   // or
 *   import { harnessFE } from '@harness-fe/webpack'
 *
 *   module.exports = { plugins: [harnessFE()] }
 *
 * Unlike previous versions (which were thin re-exports of
 * @harness-fe/unplugin/webpack), this package implements a native webpack
 * plugin that is compatible with thread-loader. See plugin.ts for the why.
 */

export { harnessFE, HarnessFEWebpackPlugin } from './plugin.js';
export type { HarnessFEOptions } from '@harness-fe/unplugin';

// Re-export transform utilities for direct usage (preserves the previous
// public surface of @harness-fe/webpack@2.x).
export {
    transformJsx,
    type ComponentMap,
    type ComponentLocation,
    type TransformResult,
} from '@harness-fe/unplugin';

import { harnessFE } from './plugin.js';
export default harnessFE;
