/**
 * Rollup-specific export.
 *
 * Usage:
 *   import { harnessaFE } from '@morphixai/harnessa-fe.unplugin/rollup'
 */

import { unplugin } from './core.js';
export type { HarnessaFEOptions } from './core.js';

export const harnessaFE = unplugin.rollup;
export default harnessaFE;
