/**
 * @harness-fe/daemon — the daemon core (capability API + event store + browser
 * control + WS bridge + identity/auth/consent). Shared by @harness-fe/mcp-server
 * (MCP protocol layer), @harness-fe/dev-cli (solo launcher), and the gateway.
 */
export * from './bridge.js';
export * from './sessionRouter.js';
export * from './auth.js';
export * from './identity.js';
export * from './remoteBridge.js';
export * from './callerContext.js';
export * from './visitorTimeline.js';
export * from './replayCreate.js';
export * from './openBrowser.js';
export * from './dashboardUrl.js';
export * from './store/index.js';
