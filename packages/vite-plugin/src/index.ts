/**
 * @morphixai/harnessa-fe.vite — Vite plugin for Harnessa-FE.
 *
 * This is a thin re-export from the unified unplugin package.
 * All plugin logic lives in @morphixai/harnessa-fe.unplugin.
 */

export { harnessaFE, type HarnessaFEOptions } from '@morphixai/harnessa-fe.unplugin/vite';
export { harnessaFE as default } from '@morphixai/harnessa-fe.unplugin/vite';

// Re-export transform utilities for direct usage
export { transformJsx, type ComponentMap, type ComponentLocation, type TransformResult } from '@morphixai/harnessa-fe.unplugin';
