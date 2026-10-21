# Proposal

## Why

The published native-image release needs a real development comparison using upstream functional tests. The portable lab has frozen samples and a browser smoke, but its old image and missing dataset adapter cannot provide Web-Bench scores.

## What Changes

- Freeze a new lab image containing Harness-FE 4.5.3; retain the previous image and runs.
- Integrate the pinned Web-Bench React and fastify-react projects, each as its full sequential 20-task chain, with the existing Kimi k3 Agent and both MCP conditions.
- Validate the upstream evaluator with reference and initial-template controls before paid attempts.
- Keep tasks, workspaces and model execution separate from reference implementations, hidden tests and grading artifacts.
- Save per-step code, tool/image/log evidence, model identity, official test output, costs and resumable execution state.

## Capabilities

### New Capabilities

None. This is benchmark tooling and an experiment, not a new product contract. `skip_specs: true` is set deliberately.

### Modified Capabilities

None. Runtime/MCP behavior is consumed from the released source without product changes.

## Impact

Owner paths: `bench/lab`, `bench/web-bench`, and local research/evidence documentation. Imports the previously validated, uncommitted portable lab with a file-hash receipt and preserves its original workspace. Air deployment and the remaining dataset adapters are later acceptance scopes; no machine/supplier switch is included in this first local pilot.
