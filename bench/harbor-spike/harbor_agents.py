"""Harbor 自定义 agent：harness-bench 条件 A（harness-fe）的零成本拓扑 stub。

不调用任何模型。做的事情与真实条件 A agent 完全相同，只差最后一步
`claude -p` 换成 MCP 层探针：

1. 起 vite dev server（后台）
2. 跑 prewarm（harness-fe daemon + headless Chromium tab）
3. 以 MCP 客户端身份对 daemon 做 initialize / tools/list / tab_list ——
   这正是 claude 通过 stdio MCP config 会做的事（去掉模型部分）
4. 写罐装 transcript 占位

探针结果写 /logs/agent/probe.json，由 tests/test.sh 汇总进 reward.json
的 mcp_topology 指标。运行方式见 bench/harbor-spike/README.md。
"""
from __future__ import annotations

from harbor.agents.installed.base import BaseInstalledAgent


class ConditionAStubAgent(BaseInstalledAgent):
    """Zero-cost stand-in for the real condition-A agent (claude + harness-fe MCP)."""

    @staticmethod
    def name() -> str:
        return "condition-a-stub"

    async def install(self, environment) -> None:
        # 镜像已预装 node 依赖、@harness-fe/cli（harness 二进制）、prewarm
        # 与 probe 脚本，无需安装步骤。
        pass

    async def run(self, instruction, environment, context) -> None:
        # 1) dev server（后台）。vite 7 只绑 localhost（Node 17+ 解析为 ::1），
        #    探 127.0.0.1 会超时——spike 阶段实测踩过。
        await self.exec_as_agent(
            environment,
            "cd /app && nohup npm run dev > /tmp/dev.log 2>&1 & "
            "for i in $(seq 1 60); do curl -sf http://localhost:5173/ > /dev/null 2>&1 && break; sleep 1; done; "
            "curl -sf http://localhost:5173/ > /dev/null",
        )

        # 2) prewarm：拉起 daemon（harness mcp）+ headless tab，等 PREWARM_READY。
        await self.exec_as_agent(
            environment,
            "cd /opt/prewarm && nohup node harness_prewarm.mjs http://localhost:5173/ > /tmp/prewarm.log 2>&1 & "
            "for i in $(seq 1 60); do grep -q PREWARM_READY /tmp/prewarm.log 2>/dev/null && break; sleep 1; done; "
            "grep -q PREWARM_READY /tmp/prewarm.log",
        )

        # 3) MCP 探针：模拟 claude 的 MCP 层（initialize/tools/list/tab_list）。
        await self.exec_as_agent(
            environment,
            "mkdir -p /logs/agent && node /opt/probe/mcp_probe.mjs > /logs/agent/probe.json",
        )

        # 4) 罐装 transcript 占位（真实 agent 这里会是 stream-json）。
        await self.exec_as_agent(
            environment,
            "printf '%s' '{\"stub\":true,\"note\":\"condition-a stub: no model call\"}' > /logs/agent/transcript.json",
        )
