/**
 * Vite-specific export.
 *
 * Usage:
 *   import { harnessFE } from '@harness-fe/unplugin/vite'
 *   export default defineConfig({ plugins: [harnessFE()] })
 */

import { unplugin } from './core.js';
export type { HarnessFEOptions } from './core.js';

export const harnessFE = unplugin.vite;
export default harnessFE;
