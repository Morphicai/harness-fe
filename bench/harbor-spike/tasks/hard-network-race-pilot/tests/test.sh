#!/bin/bash
# Pilot verifier：oracle 判定 + 从 stream-json transcript 提取 steps/cost。
mkdir -p /logs/verifier

START=$(date +%s)
node /opt/oracle/oracle.mjs /app > /logs/verifier/oracle.log 2>&1
RC=$?
END=$(date +%s)

FIXED=0
if [ $RC -eq 0 ]; then FIXED=1; fi

node /opt/oracle/verifier-metrics.mjs \
    /logs/agent/transcript.stream.json "$FIXED" "$((END - START))" \
    > /logs/verifier/reward.json

cat /logs/verifier/reward.json
echo
tail -3 /logs/verifier/oracle.log || true
echo "[test.sh] oracle rc=$RC fixed=$FIXED"
