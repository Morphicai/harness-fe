/**
 * Rspack-specific export.
 *
 * Usage:
 *   import { harnessFE } from '@harness-fe/unplugin/rspack'
 */

import { unplugin } from './core.js';
export type { HarnessFEOptions } from './core.js';

export const harnessFE = unplugin.rspack;
export default harnessFE;
