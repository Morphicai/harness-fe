# 条件 A 任务环境：harnessFE 插件版 vite 应用 + harness-fe CLI + prewarm + 探针。
FROM mcr.microsoft.com/playwright:v1.62.1-noble

RUN apt-get update && apt-get install -y --no-install-recommends patch && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY app/ /app/
RUN npm install --no-audit --no-fund

# 条件 A 的 vite config：注入 harnessFE 插件（runtime SDK 经 ws 连 loopback daemon）。
COPY vite.config.ts.harness /app/vite.config.ts

COPY bug.patch /tmp/bug.patch
RUN patch -p1 < /tmp/bug.patch && rm /tmp/bug.patch

# harness-fe CLI 全局预装（daemon + stdio MCP server，二进制名 harness），
# 避免运行时 npx -y 拉取。
RUN npm install -g @harness-fe/cli --no-audit --no-fund

COPY prewarm/ /opt/prewarm/
RUN cd /opt/prewarm && npm install --no-audit --no-fund

COPY probe/ /opt/probe/

COPY oracle/ /opt/oracle/
RUN cd /opt/oracle && npm install --no-audit --no-fund
