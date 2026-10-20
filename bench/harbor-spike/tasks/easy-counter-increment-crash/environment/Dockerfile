# harness-bench spike 任务环境：vite 应用 + 注入 bug + oracle 依赖。
# base 镜像自带 node 22 与匹配版本的 Chromium（含系统依赖）。
FROM mcr.microsoft.com/playwright:v1.62.1-noble

RUN apt-get update && apt-get install -y --no-install-recommends patch && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# 应用源码由 prepare.sh 生成（react-demo 副本，workspace:* 已改写为 latest）。
COPY app/ /app/
RUN npm install --no-audit --no-fund

# oracle 只关心"修完的应用行为是否正确"，不需要 harness-fe 插件；
# 用与 bench runner.py 相同的 plain vite config 覆盖 demo 自带的
# governed-gateway 配置（那个配置指向一个本 spike 不启动的网关）。
COPY vite.config.ts.plain /app/vite.config.ts

# 注入 bug（真实跑分时代理需要修的就是它；oracle 模式由 solve.sh 反向应用）。
COPY bug.patch /tmp/bug.patch
RUN patch -p1 < /tmp/bug.patch && rm /tmp/bug.patch

# oracle 运行时装到独立目录：ESM 导入从脚本所在目录解析 node_modules，
# 因此 oracle.mjs 必须在 /opt/oracle 下运行（见 tests/test.sh）。
COPY oracle/ /opt/oracle/
RUN cd /opt/oracle && npm install --no-audit --no-fund
