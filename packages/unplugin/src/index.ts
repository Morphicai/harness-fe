/**
 * @harnessa-fe/unplugin — unified build plugin.
 *
 * Usage:
 *   import { harnessaFE } from '@harnessa-fe/unplugin/vite'
 *   import { harnessaFE } from '@harnessa-fe/unplugin/webpack'
 *   import { harnessaFE } from '@harnessa-fe/unplugin/rspack'
 *
 * Or import the raw unplugin for custom integrations:
 *   import { unplugin, unpluginFactory } from '@harnessa-fe/unplugin'
 */

export { unplugin, unpluginFactory, type HarnessaFEOptions } from './core.js';
export { transformJsx, type ComponentMap, type ComponentLocation, type TransformResult } from './transform.js';
export { transformVueSFC, type VueTransformResult } from './vue-transform.js';
