/**
 * @harness-fe/gateway — the only front door. Embeds @harness-fe/core in-process
 * and exposes /mcp (agent MCP, RBAC + scoped manifest + audit), /ws (runtime WS,
 * write scope), /events (HTTP batch), /console (data + back office), and /admin
 * (governance). Policy: Open (solo loopback) | Governed (team tokens).
 */
export { createGateway } from './server.js';
export type { GatewayOptions, GatewayHandle } from './server.js';

export { Policy } from './policy.js';
export type { PolicyMode, Resolved } from './policy.js';

export {
    principalFromCaller,
    hasWriteScope,
    extractToken,
    OPEN_PRINCIPAL,
} from './principal.js';

export { createMcpServer, startMcpStdioServer, experimentalEnabled } from './mcp.js';
export type { McpServerOptions } from './mcp.js';
export { startMcpStdioProxy } from './mcpProxy.js';
export { createMcpHttpHandler } from './mcpHttp.js';
export type { McpHttpOptions, McpHttpHandler } from './mcpHttp.js';
export { attachRuntimeWs } from './runtimeWs.js';
export type { RuntimeWsOptions, RuntimeWsHandle } from './runtimeWs.js';
export { createConsoleHandler } from './console.js';
export type { ConsoleOptions } from './console.js';

export { requiredScope, allowsTool, filterManifest } from './scope.js';
export { createAdminHandler } from './admin.js';
export { GatewayStore } from './store.js';
export type {
    Scope,
    ServerRecord,
    TokenRecord,
    AuditEntry,
    VerifiedCaller,
    AdminRecord,
} from './store.js';
export {
    generateToken,
    parseToken,
    hashSecret,
    verifySecret,
    type SecretHash,
} from './tokens.js';
