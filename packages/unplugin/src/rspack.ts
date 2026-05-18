/**
 * Rspack-specific export.
 *
 * Usage:
 *   import { harnessaFE } from '@harnessa-fe/unplugin/rspack'
 */

import { unplugin } from './core.js';
export type { HarnessaFEOptions } from './core.js';

export const harnessaFE = unplugin.rspack;
export default harnessaFE;
