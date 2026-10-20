#!/bin/bash
# Harbor verifier 入口。不用 set -e：无论 oracle 结果如何都要写 reward.json。
mkdir -p /logs/verifier

START=$(date +%s)
node /opt/oracle/oracle.mjs /app > /logs/verifier/oracle.log 2>&1
RC=$?
END=$(date +%s)

FIXED=0
if [ $RC -eq 0 ]; then FIXED=1; fi

cat > /logs/verifier/reward.json <<EOF
{
  "fixed": $FIXED,
  "oracle_duration_s": $((END - START)),
  "multi_metric_proof": 1
}
EOF

cat /logs/verifier/oracle.log
echo "[test.sh] oracle rc=$RC fixed=$FIXED"
