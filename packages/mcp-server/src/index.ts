export { Bridge, defaultDataDir, type BridgeOptions } from '@harness-fe/daemon';
export { createDaemon, type DaemonOptions, type DaemonHandle } from './daemon.js';
export { SessionRouter, type PeerSession } from '@harness-fe/daemon';
export {
    startMcpStdioServer,
    createMcpServer,
    experimentalEnabled,
    type McpServerOptions,
} from './mcp.js';
export { startMcpHttpServer, type McpHttpOptions, type McpHttpHandle } from './mcpHttp.js';
export {
    JsonlStore,
    JsonTaskStore,
    JsonMemoryStore,
    MemoryEventStore,
    sanitizeId,
    type MemoryEventStoreOptions,
} from '@harness-fe/daemon';
export type {
    IStore,
    ITaskStore,
    IMemoryStore,
    EventStore,
    EventId,
    StreamId,
    ProjectMeta,
    ProjectTreeNode,
    BuildMeta,
    SessionMeta,
    TabMeta,
} from '@harness-fe/daemon';
