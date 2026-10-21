// Preserve the live observer MCP connection via a transparent local transport.
import { startMcpStdioProxy } from '../../packages/gateway/dist/mcpProxy.js';
await startMcpStdioProxy(process.argv[2]);
