/**
 * Condition-A MCP 探针（零模型成本）。
 *
 * 以最小 MCP stdio 客户端身份连接 harness-fe daemon，做 claude 通过
 * .mcp.json 会做的三件事：initialize → tools/list → tools/call tab_list。
 * 输出单个 JSON 到 stdout：
 *   { initialized, toolCount, tabCount, firstTabUrl? , error? }
 * tabCount >= 1 即证明"prewarm 的浏览器 tab 已注册到 daemon，agent 侧
 * MCP 工具能看见它"——条件 A 拓扑成立。
 *
 * 与 bench/prewarm/harness_prewarm.mjs 的一处偏差：直接调全局安装的
 * `harness` 二进制（镜像内 npm i -g @harness-fe/cli），不走 npx -y。
 */
import { spawn } from 'node:child_process';

const TIMEOUT_MS = 60_000;
const result = { initialized: false, toolCount: 0, tabCount: 0 };

const server = spawn('harness', ['mcp'], { stdio: ['pipe', 'pipe', 'pipe'] });
let stderr = '';
server.stderr.on('data', (d) => { stderr += d.toString(); });

let buffer = '';
const pending = new Map();
server.stdout.on('data', (chunk) => {
    buffer += chunk.toString();
    let idx;
    while ((idx = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, idx).trim();
        buffer = buffer.slice(idx + 1);
        if (!line) continue;
        let msg;
        try { msg = JSON.parse(line); } catch { continue; }
        if (msg.id !== undefined && pending.has(msg.id)) {
            pending.get(msg.id)(msg);
            pending.delete(msg.id);
        }
    }
});

function request(id, method, params) {
    return new Promise((resolve, reject) => {
        pending.set(id, resolve);
        server.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
        setTimeout(() => reject(new Error(`request ${method} timed out`)), TIMEOUT_MS);
    });
}

const killTimer = setTimeout(() => {
    result.error = 'overall timeout';
    console.log(JSON.stringify(result));
    process.exit(1);
}, TIMEOUT_MS);

try {
    const init = await request(1, 'initialize', {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'harbor-spike-probe', version: '0.1.0' },
    });
    result.initialized = Boolean(init.result);
    server.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');

    const tools = await request(2, 'tools/list', {});
    result.toolCount = tools.result?.tools?.length ?? 0;
    result.toolNames = (tools.result?.tools ?? []).map((t) => t.name).slice(0, 12);

    // 注意：发布版 @harness-fe/cli（v4.5.2）的工具名是点分格式 tab.list，
    // 不是旧文档里的 tab_list。
    const tabs = await request(3, 'tools/call', { name: 'tab.list', arguments: {} });
    const text = tabs.result?.content?.map((c) => c.text ?? '').join('\n') ?? '';
    try {
        const parsed = JSON.parse(text);
        result.tabCount = Array.isArray(parsed) ? parsed.length : (parsed.tabs?.length ?? 0);
        result.firstTabUrl = (Array.isArray(parsed) ? parsed[0] : parsed.tabs?.[0])?.url;
    } catch {
        result.tabCount = -1;
        result.tabListRaw = text.slice(0, 500);
    }
} catch (err) {
    result.error = String(err);
    result.stderrTail = stderr.slice(-500);
} finally {
    clearTimeout(killTimer);
    server.kill('SIGTERM');
}

console.log(JSON.stringify(result));
process.exit(result.error ? 1 : 0);
