#!/bin/bash
# 生成 Harbor 任务的构建材料（幂等）：
#   1. react-demo 副本 → tasks/<task>/environment/app（workspace:* → latest，
#      与 bench/bench/runner.py::_make_installable 同一逻辑）
#   2. fixture 的 bug.patch → environment/（+ 首个任务的 solution/fix.patch）
#   3. 每个任务的 oracle 目录 = shared-oracle/（package.json + verifier-metrics.mjs）
#      + 该 fixture 的 oracle.mjs（sed 适配相对导入）+ lib/browserOracle.mjs
#      （sed 注入 --no-sandbox，容器内 root 运行 Chromium 需要）
set -euo pipefail

HERE=$(cd "$(dirname "$0")" && pwd)
REPO=$(cd "$HERE/../.." && pwd)
FIXTURES="$REPO/bench/fixtures/react-demo"

# task目录名:fixture名
TASKS=(
  "easy-counter-increment-crash:easy-counter-increment-crash"
  "easy-counter-increment-crash-cond-a:easy-counter-increment-crash"
  "easy-counter-increment-crash-pilot:easy-counter-increment-crash"
  "hard-network-race-pilot:hard-network-race-stale-response"
)

for pair in "${TASKS[@]}"; do
  TASK_NAME="${pair%%:*}"
  FIXTURE_NAME="${pair##*:}"
  TASK="$HERE/tasks/$TASK_NAME"
  FIXTURE="$FIXTURES/$FIXTURE_NAME"

  DEST="$TASK/environment/app"
  rm -rf "$DEST"
  mkdir -p "$DEST"
  rsync -a --exclude node_modules --exclude dist --exclude .turbo --exclude e2e \
    "$REPO/examples/react-demo/" "$DEST/"
  rm -f "$DEST/pnpm-lock.yaml"

  node -e '
const fs = require("fs");
const p = process.argv[1];
const j = JSON.parse(fs.readFileSync(p, "utf8"));
for (const g of ["dependencies", "devDependencies"]) {
  for (const [k, v] of Object.entries(j[g] || {})) {
    if (v === "workspace:*") j[g][k] = "latest";
  }
}
fs.writeFileSync(p, JSON.stringify(j, null, 4) + "\n");
' "$DEST/package.json"

  cp "$FIXTURE/bug.patch" "$TASK/environment/bug.patch"

  # oracle 目录：shared-oracle + fixture oracle（适配导入路径与 --no-sandbox）
  ORACLE_DIR="$TASK/environment/oracle"
  rm -rf "$ORACLE_DIR"
  mkdir -p "$ORACLE_DIR/lib"
  cp "$HERE/shared-oracle/package.json" "$HERE/shared-oracle/verifier-metrics.mjs" "$ORACLE_DIR/"
  sed 's|\.\./\.\./_lib/browserOracle\.mjs|./lib/browserOracle.mjs|' \
    "$FIXTURE/oracle.mjs" > "$ORACLE_DIR/oracle.mjs"
  sed "s|chromium.launch({ headless: true })|chromium.launch({ headless: true, args: ['--no-sandbox'] })|" \
    "$FIXTURES/../_lib/browserOracle.mjs" > "$ORACLE_DIR/lib/browserOracle.mjs"

  # solution/fix.patch 只写给有 solution/ 目录的任务
  if [ -d "$TASK/solution" ]; then
    cp "$FIXTURE/bug.patch" "$TASK/solution/fix.patch"
  fi

  echo "prepared: $TASK_NAME (fixture: $FIXTURE_NAME)"
done
