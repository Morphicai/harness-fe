/**
 * @harnessa-fe/webpack — Webpack plugin for Harnessa-FE.
 *
 * Usage:
 *   const { harnessaFE } = require('@harnessa-fe/webpack')
 *   // or
 *   import { harnessaFE } from '@harnessa-fe/webpack'
 *
 *   module.exports = { plugins: [harnessaFE()] }
 *
 * This is a thin re-export from the unified unplugin package.
 * All plugin logic lives in @harnessa-fe/unplugin.
 */

import { unplugin, type HarnessaFEOptions } from '@harnessa-fe/unplugin';

export type { HarnessaFEOptions } from '@harnessa-fe/unplugin';

export const harnessaFE = unplugin.webpack;
export default harnessaFE;

// Re-export transform utilities for direct usage
export { transformJsx, type ComponentMap, type ComponentLocation, type TransformResult } from '@harnessa-fe/unplugin';
