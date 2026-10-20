#!/bin/bash
# Oracle agent 的"金标准修复"：反向应用注入的 bug.patch。
# 顺带冒烟验证 spike 目标 2：agent 阶段能起后台服务（vite dev server）并访问。
set -e

cd /app
nohup npm run dev > /tmp/devserver.log 2>&1 &
DEV_PID=$!
READY=0
# 注意：vite 7 默认只绑 localhost（Node 17+ 解析为 ::1），探 127.0.0.1 会失败。
for i in $(seq 1 30); do
    if curl -sf http://localhost:5173/ > /tmp/index.html 2>/dev/null; then READY=1; break; fi
    sleep 1
done
if [ "$READY" = "1" ] && grep -qi '<div id="root">' /tmp/index.html; then
    echo "[solve] background dev server reachable ✓"
else
    echo "[solve] WARN: dev server not reachable within 30s"
    tail -20 /tmp/devserver.log || true
fi
kill $DEV_PID 2>/dev/null || true

patch -p1 -R -d /app < /solution/fix.patch
echo "[solve] gold fix applied (bug.patch reversed)"
