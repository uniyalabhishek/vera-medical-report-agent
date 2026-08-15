# MVP UI Design System

The three files in `design/concepts/` are the visual specification for intake, review, and explanation.

## Direction

- Calm, precise, and human. Never falsely reassuring.
- True white canvas with deep sage as the primary action color.
- Open editorial layouts with thin dividers. Avoid dashboard card grids.
- Warm humanist sans-serif typography.
- Deterministic range, trend, source, and medication visuals.

## Tokens

| Token | Value | Use |
|---|---|---|
| Canvas | `#ffffff` | Page background |
| Ink | `#17202b` | Primary text |
| Muted | `#5f6978` | Supporting text |
| Sage | `#2d6553` | Primary actions and confirmed states |
| Sage dark | `#234d40` | Hover and high-emphasis text |
| Sage soft | `#eef5f2` | Selected and quiet success states |
| Blue soft | `#f5f8fb` | Document and answer surfaces |
| Blue line | `#6482a5` | Source regions and range visuals |
| Sand soft | `#fff7e9` | Needs-review and printed-high/low states |
| Sand line | `#e1b86e` | Needs-review border |
| Border | `#d9dee3` | Rules and controls |

Typography uses `Avenir Next`, `Segoe UI`, and the system sans-serif fallback. Headings use tight tracking and 1.08–1.18 line height. Body and control text stay at 15–17px on desktop.

## Layout

- Maximum content width: 1440px.
- Desktop gutters: 40–48px. Mobile gutters: 20px.
- Header: 72px.
- Main reading column: roughly two thirds; source or Q&A rail: one third.
- Controls: 48–56px high, 8–10px radius, 1px border.
- Responsive breakpoint: collapse rails below the main content at 900px.

## Component families

- Brand header and four-step progress line.
- Form fields, text areas, language select, and microphone action.
- Drop zone and uploaded-file row.
- Structured fact rows with editable fields and confirmation checks.
- Synthetic source document with source-region highlights.
- Five open explanation sections separated by rules.
- Reference-range bar and historical timeline.
- Source-link buttons and source drawer.
- Sticky grounded-Q&A rail.
- Full-width mobile action bar.

## Motion

- 160–220ms ease-out for focus, hover, and state changes.
- A short opacity/translate transition when advancing steps.
- No decorative animation. Respect `prefers-reduced-motion`.

## Icon treatment

Use 1.7px rounded outline icons at 18–22px. The brand mark is a small custom leaf SVG. All functional icons have visible labels or accessible names.

