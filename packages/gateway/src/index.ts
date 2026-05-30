/**
 * @harness-fe/gateway — governance gateway in front of one or more daemons.
 * Token lifecycle + RBAC + audit + token→server routing + dynamic manifest +
 * admin panel. Zero native deps (JSON store + node:crypto scrypt).
 *
 * C2 (this slice): data layer + tokens. Routing / RBAC / manifest / admin land
 * in C3–C5.
 */
export { createGateway } from './server.js';
export type { GatewayOptions, GatewayHandle } from './server.js';
export { requiredScope, allowsTool, filterManifest } from './scope.js';
export { GatewayStore } from './store.js';
export type {
    Scope,
    ServerRecord,
    TokenRecord,
    AuditEntry,
    VerifiedCaller,
} from './store.js';
export {
    generateToken,
    parseToken,
    hashSecret,
    verifySecret,
    type SecretHash,
} from './tokens.js';
