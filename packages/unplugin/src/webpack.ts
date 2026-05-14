/**
 * Webpack-specific export.
 *
 * Usage:
 *   import { harnessaFE } from '@morphixai/harnessa-fe.unplugin/webpack'
 *   // or
 *   const { harnessaFE } = require('@morphixai/harnessa-fe.unplugin/webpack')
 *
 *   module.exports = { plugins: [harnessaFE()] }
 */

import { unplugin } from './core.js';
export type { HarnessaFEOptions } from './core.js';

export const harnessaFE = unplugin.webpack;
export default harnessaFE;
