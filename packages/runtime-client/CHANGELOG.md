# @harnessa-fe/runtime

## 1.0.0

### Minor Changes

- 2019214: Version alignment: reset `@harnessa-fe/log` and `@harnessa-fe/next` to the 0.9.x line, locking all core packages together via `linked` in `.changeset/config.json`

  Background: `@harnessa-fe/log`'s initial Changesets minor bump took it to **1.0.0** (Changesets treats brand-new packages as starting at 1.0.0 unless explicitly minor-bumped from a prior 0.x), then the next minor pushed it to 2.0.0 — leaving the rest of the ecosystem at 0.6–0.9 while `log` and `next` (which transitively bumped) sat at 2.0. Functionally fine, but cosmetically off.

  Since morphicai-web is the only consumer and hasn't shipped publicly, accepting the inconvenience of a version downgrade is cheap. The previous `log@{1.0.0, 2.0.0, 2.0.1}` and `next@{1.0.0, 2.0.0}` releases will be deprecated on npmjs.com pointing to 0.9.x as the canonical line.

  This changeset bumps **every** core package by `minor` so they all land at the same 0.x.0 going forward, plus locks them via `linked` so future bumps stay in lockstep. Also includes the Turbopack-fix browser/node split for `@harnessa-fe/log` that was previously queued as a patch.

### Patch Changes

- Updated dependencies [2019214]
  - @harnessa-fe/protocol@1.0.0

## 0.6.4

### Patch Changes

- 88af49d: UX: screenshots are now optional, with inline preview

  The "Report a problem" flow no longer auto-launches the annotate modal on every element pick. After locking an element the user goes straight to the question textarea; a "📷 Add screenshot" button is available if they want to attach an annotated PNG. When attached, the question panel shows a thumbnail preview with Edit + Remove controls. Esc inside annotate preserves any prior attachment and returns to the question step.

## 0.6.3

### Patch Changes

- Updated dependencies [c4a1f59]
  - @harnessa-fe/protocol@0.7.0
