#!/bin/bash
# Harbor verifier 入口（条件 A stub 任务）。不用 set -e：无论如何都写 reward.json。
# 两个指标：
#   fixed         —— oracle 对 bug 是否修复的判定（stub 不修 bug，预期 0）
#   mcp_topology  —— agent 阶段的 MCP 探针是否证明 daemon+tab+MCP 链路通（预期 1）
mkdir -p /logs/verifier

START=$(date +%s)
node /opt/oracle/oracle.mjs /app > /logs/verifier/oracle.log 2>&1
RC=$?
END=$(date +%s)

FIXED=0
if [ $RC -eq 0 ]; then FIXED=1; fi

TOPO=0
if [ -f /logs/agent/probe.json ]; then
    TOPO=$(node -e '
const p = JSON.parse(require("fs").readFileSync("/logs/agent/probe.json", "utf8"));
process.stdout.write(p.initialized && p.toolCount > 0 && p.tabCount >= 1 ? "1" : "0");
' 2>/dev/null || echo 0)
fi

cat > /logs/verifier/reward.json <<EOF
{
  "fixed": $FIXED,
  "mcp_topology": $TOPO,
  "oracle_duration_s": $((END - START))
}
EOF

cat /logs/verifier/oracle.log || true
echo "[test.sh] oracle rc=$RC fixed=$FIXED mcp_topology=$TOPO"
