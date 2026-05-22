/**
 * esbuild-specific export.
 *
 * Usage:
 *   import { harnessFE } from '@harness-fe/unplugin/esbuild'
 */

import { unplugin } from './core.js';
export type { HarnessFEOptions } from './core.js';

export const harnessFE = unplugin.esbuild;
export default harnessFE;
