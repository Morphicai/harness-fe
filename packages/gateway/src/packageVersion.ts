import { createRequire } from 'node:module';

/** Package identity for deployment checks; independent of the wire protocol. */
const require = createRequire(import.meta.url);
export const GATEWAY_PACKAGE_VERSION: string = require('../package.json').version;
