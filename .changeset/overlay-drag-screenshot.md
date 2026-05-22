---
'@harnessa-fe/runtime': minor
'@harnessa-fe/protocol': patch
---

Overlay UX + screenshot fixes:

### Draggable FAB with position persistence
The floating "H" button can now be dragged anywhere on screen. The
position is saved to `localStorage` (`__harnessa_fe_fab_pos__`) and
clamped into the viewport on every load — resilient to monitor
swaps, dev-tools panel changes, and viewport resizes. Follower cards
(info / reports / question) anchor relative to the FAB and flip side
based on available space, so they're always reachable no matter where
you drop the button.

A 5px movement threshold separates click from drag; clicking the FAB
still opens the info card, dragging it never does.

### Dark, glass-style cards
The info / reports / question panels switched to a dark theme with
backdrop blur, matching the new dashboard SPA's Linear-style palette.
Info pills, primary/secondary buttons, and status dots refreshed for
contrast and clarity on both light and dark host pages.

### Screenshot fixes
- **Overlay no longer bleeds into screenshots.** The "H" FAB and any
  open info card used to land in the corner of every shot. The
  `PAGE_SCREENSHOT` handler now flips `visibility: hidden` on the
  overlay host for the duration of the capture, restoring it
  (try/finally — survives capture errors) immediately after.
- **Default to opaque background.** Captures were rendering blank for
  pages with no explicit body background. Default is now `#ffffff`;
  callers can pass `backgroundColor: '#0a0a0f'` (or any CSS color)
  for a dark backdrop, or `backgroundColor: null` to opt back into a
  transparent capture (PNG/WebP only — JPEG has no alpha).

### Tests
9 new tests:
- 4 in `overlay.test.ts` — default position, persisted restore, viewport clamp on shrink, malformed-storage fallback
- 5 in `commands.test.ts` (new file) — default opaque background, transparent opt-in via null, custom color, overlay-hidden during capture, overlay restored on error
