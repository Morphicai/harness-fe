---
"@harness-fe/runtime": patch
---

fix(runtime-client): dispatch full click event sequence, not bare 'click'

Portal-based menus (Radix UI Popover/DropdownMenu and similar) gate their open logic on `pointerdown`, so a single synthetic `click` event never triggered them. `page.click` now dispatches `pointerdown → mousedown → pointerup → mouseup → click` in bubbling order, matching a real click gesture. Verified against a real `@radix-ui/react-dropdown-menu` component in a real browser — the trigger's `data-state` now flips `closed → open` and the portal content mounts (harness-fe#203).
