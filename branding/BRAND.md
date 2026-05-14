# Harnessa-FE Brand Guidelines

## Logo

The Harnessa-FE logo features an abstract "H" letterform within a gradient circle. The curved horizontal bridge represents the connection between build tools, browser runtime, and AI agents — the core "harness" concept.

- **Primary logo:** `logo.svg` (vector, scalable)
- **Avatar/favicon:** `logo-128.png` (128×128 raster)

## Colors

| Role    | Name           | Hex       | Usage                                      |
|---------|----------------|-----------|--------------------------------------------|
| Primary | Morphix Purple | `#6C5CE7` | Headings, primary buttons, logo gradient start |
| Accent  | Harness Teal   | `#00D2D3` | Links, highlights, logo gradient end        |

### Extended Palette

| Role       | Hex       | Usage                        |
|------------|-----------|------------------------------|
| Dark       | `#1E1E2E` | Code blocks, dark backgrounds |
| Light      | `#F8F9FA` | Page backgrounds              |
| Text       | `#2D3436` | Body text                     |

## Typography

| Role     | Font Family                          | Weight        | Usage                    |
|----------|--------------------------------------|---------------|--------------------------|
| Heading  | Inter                                | 600 (Semi-Bold) | Headings, navigation     |
| Body     | Inter                                | 400 (Regular)   | Body text, descriptions  |
| Code     | JetBrains Mono                       | 400 (Regular)   | Code snippets, terminals |

### Font Stack (CSS)

```css
--font-heading: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
--font-body: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
--font-code: 'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace;
```

## Usage Guidelines

- Always maintain a minimum clear space around the logo equal to the height of the diamond accent.
- Do not stretch, rotate, or alter the logo colors.
- On dark backgrounds, use the logo as-is (the white letterform provides contrast).
- On light backgrounds, the gradient circle provides sufficient contrast.
- Minimum display size: 32×32 pixels.
