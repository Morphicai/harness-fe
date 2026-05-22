/**
 * @harness-fe/vite — Vite plugin for Harness-FE.
 *
 * This is a thin re-export from the unified unplugin package.
 * All plugin logic lives in @harness-fe/unplugin.
 */

export { harnessFE, type HarnessFEOptions } from '@harness-fe/unplugin/vite';
export { harnessFE as default } from '@harness-fe/unplugin/vite';

// Re-export transform utilities for direct usage
export { transformJsx, type ComponentMap, type ComponentLocation, type TransformResult } from '@harness-fe/unplugin';
