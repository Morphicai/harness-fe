/**
 * Pilot verifier 指标汇总：从 claude stream-json transcript 提取
 * steps（tool_use 计数，镜像 bench/bench/runner.py::extract_metrics 的结构）
 * 与 total_cost_usd，合并 oracle 的 fixed 判定写 reward.json。
 *
 * usage: node verifier-metrics.mjs <transcript.stream.json> <fixed 0|1> <oracle_duration_s>
 */
import { readFileSync, existsSync } from 'node:fs';

const [, , transcriptPath, fixed, duration] = process.argv;

let steps = 0;
let cost = 0;
if (transcriptPath && existsSync(transcriptPath)) {
    for (const line of readFileSync(transcriptPath, 'utf8').split('\n')) {
        if (!line.trim()) continue;
        let e;
        try { e = JSON.parse(line); } catch { continue; }
        if (e.type === 'assistant') {
            for (const item of e.message?.content ?? []) {
                if (item && item.type === 'tool_use') steps++;
            }
        }
        if (typeof e.total_cost_usd === 'number') cost = e.total_cost_usd;
    }
}

console.log(JSON.stringify({
    fixed: Number(fixed),
    steps,
    cost_usd: cost,
    oracle_duration_s: Number(duration),
}, null, 2));
