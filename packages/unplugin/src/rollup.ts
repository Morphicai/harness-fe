/**
 * Rollup-specific export.
 *
 * Usage:
 *   import { harnessFE } from '@harness-fe/unplugin/rollup'
 */

import { unplugin } from './core.js';
export type { HarnessFEOptions } from './core.js';

export const harnessFE = unplugin.rollup;
export default harnessFE;
