# Pilot 任务环境：三条件共用一个镜像（与 bench/docker/Dockerfile 同一思路），
# 条件差异全部由 agent 在 run() 里按 --ak condition=... 注入
# （vite config + .mcp.json + 是否 prewarm）。
FROM mcr.microsoft.com/playwright:v1.62.1-noble

RUN apt-get update && apt-get install -y --no-install-recommends patch && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY app/ /app/
RUN npm install --no-audit --no-fund

COPY bug.patch /tmp/bug.patch
RUN patch -p1 < /tmp/bug.patch && rm /tmp/bug.patch

# 三条件所需的全局 CLI：
#   harness             —— 条件 A 的 daemon + stdio MCP server（@harness-fe/cli）
#   chrome-devtools-mcp —— 条件 B 的 MCP server（postinstall 会拉 Chrome for Testing）
#   claude              —— 被测对象（@anthropic-ai/claude-code）
RUN npm install -g @harness-fe/cli chrome-devtools-mcp @anthropic-ai/claude-code --no-audit --no-fund

COPY vite-configs/ /opt/vite-configs/
COPY mcp-configs/ /opt/mcp-configs/

COPY prewarm/ /opt/prewarm/
RUN cd /opt/prewarm && npm install --no-audit --no-fund

COPY oracle/ /opt/oracle/
RUN cd /opt/oracle && npm install --no-audit --no-fund
