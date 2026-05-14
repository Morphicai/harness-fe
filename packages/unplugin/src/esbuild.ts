/**
 * esbuild-specific export.
 *
 * Usage:
 *   import { harnessaFE } from '@morphixai/harnessa-fe.unplugin/esbuild'
 */

import { unplugin } from './core.js';
export type { HarnessaFEOptions } from './core.js';

export const harnessaFE = unplugin.esbuild;
export default harnessaFE;
