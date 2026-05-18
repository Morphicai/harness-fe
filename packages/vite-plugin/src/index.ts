/**
 * @harnessa-fe/vite — Vite plugin for Harnessa-FE.
 *
 * This is a thin re-export from the unified unplugin package.
 * All plugin logic lives in @harnessa-fe/unplugin.
 */

export { harnessaFE, type HarnessaFEOptions } from '@harnessa-fe/unplugin/vite';
export { harnessaFE as default } from '@harnessa-fe/unplugin/vite';

// Re-export transform utilities for direct usage
export { transformJsx, type ComponentMap, type ComponentLocation, type TransformResult } from '@harnessa-fe/unplugin';
