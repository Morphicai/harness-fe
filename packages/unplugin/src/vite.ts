/**
 * Vite-specific export.
 *
 * Usage:
 *   import { harnessaFE } from '@morphixai/harnessa-fe.unplugin/vite'
 *   export default defineConfig({ plugins: [harnessaFE()] })
 */

import { unplugin } from './core.js';
export type { HarnessaFEOptions } from './core.js';

export const harnessaFE = unplugin.vite;
export default harnessaFE;
