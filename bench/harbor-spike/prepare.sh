#!/bin/bash
# 生成 Harbor 任务的构建材料：react-demo 副本（workspace:* → latest，与
# bench/bench/runner.py::_make_installable 同一逻辑）+ fixture 的 bug.patch
# + 共享 oracle。幂等：重复执行先清空再生成。
set -euo pipefail

HERE=$(cd "$(dirname "$0")" && pwd)
REPO=$(cd "$HERE/../.." && pwd)
FIXTURE="$REPO/bench/fixtures/react-demo/easy-counter-increment-crash"

TASKS=(
  "$HERE/tasks/easy-counter-increment-crash"
  "$HERE/tasks/easy-counter-increment-crash-cond-a"
)

for TASK in "${TASKS[@]}"; do
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
  echo "prepared: $DEST"
done

# solution/fix.patch 只有 oracle 任务需要
cp "$FIXTURE/bug.patch" "${TASKS[0]}/solution/fix.patch"
# 共享 oracle 同步给 cond-a 任务（内容一致，来源单一）
rsync -a --delete "${TASKS[0]}/environment/oracle/" "${TASKS[1]}/environment/oracle/"
echo "oracle synced to cond-a task"
