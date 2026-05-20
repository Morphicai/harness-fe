# @harnessa-fe/runtime

## 0.6.4

### Patch Changes

- 88af49d: UX: screenshots are now optional, with inline preview

  The "Report a problem" flow no longer auto-launches the annotate modal on every element pick. After locking an element the user goes straight to the question textarea; a "📷 Add screenshot" button is available if they want to attach an annotated PNG. When attached, the question panel shows a thumbnail preview with Edit + Remove controls. Esc inside annotate preserves any prior attachment and returns to the question step.

## 0.6.3

### Patch Changes

- Updated dependencies [c4a1f59]
  - @harnessa-fe/protocol@0.7.0
