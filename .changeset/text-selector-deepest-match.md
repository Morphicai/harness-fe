---
'@harness-fe/runtime': patch
---

Text-only selectors (`{text: '…'}`) now resolve the element that owns the text
instead of `<html>`. Every ancestor of the real target trivially "contains" the
string via `textContent`, and the document-order scan returned the outermost one
— so `page.click({text: 'Save'})` clicked the whole document and silently did
nothing. Matches are now tiered (own direct text → own full text → substring)
and, within a tier, an element containing another match yields to the inner one.
`role` + `nth` behaviour is unchanged.
