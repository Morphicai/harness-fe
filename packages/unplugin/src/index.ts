/**
 * @morphixai/harnessa-fe.unplugin — unified build plugin.
 *
 * Usage:
 *   import { harnessaFE } from '@morphixai/harnessa-fe.unplugin/vite'
 *   import { harnessaFE } from '@morphixai/harnessa-fe.unplugin/webpack'
 *   import { harnessaFE } from '@morphixai/harnessa-fe.unplugin/rspack'
 *
 * Or import the raw unplugin for custom integrations:
 *   import { unplugin, unpluginFactory } from '@morphixai/harnessa-fe.unplugin'
 */

export { unplugin, unpluginFactory, type HarnessaFEOptions } from './core.js';
export { transformJsx, type ComponentMap, type ComponentLocation, type TransformResult } from './transform.js';
export { transformVueSFC, type VueTransformResult } from './vue-transform.js';
