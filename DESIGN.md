# Dexter JP Design System Reference

**Design version:** `dexter_design_v1`

**Status:** Visual Source of Truth — approved DR-0 contract (PR #94 merged)

**Last Updated:** 2026-09-03

## 1. Authority and priority

Read this file before making any design decision for a task that creates or changes
user-facing UI.

This file is the sole Source of Truth for:

- color;
- typography;
- spacing;
- border radius;
- component styling; and
- visual hierarchy.

Do not define a conflicting visual value in application code, CSS, a component, or a
phase plan. Reuse the tokens and component patterns below. If a genuinely new visual
need is not covered, update this file in the same reviewed change before using the
new value.

`AGENTS.md` continues to control repository operation and safety. `docs/SPEC.md` and
the applicable plan continue to control product behavior, data meaning, source
semantics, security, and functional contracts. Accessibility, usability, semantic
and financial accuracy, and functional correctness take priority over visual
imitation. When one of those constraints requires a visual-system change, amend this
file explicitly; do not add an ad hoc exception in code.

The direction combines Glassnode-like analytical density with restrained Seline-like
light surfaces. The previously considered Refero pages are non-normative mood-board
references only:

- <https://styles.refero.design/style/7967c6d9-e50c-42b5-b4d1-74003ba41781>
- <https://styles.refero.design/style/a79b6a74-6b67-4c9f-9d69-bff80869b943>

No external site's font, image, icon, code, token, layout, or other proprietary asset
is copied or loaded. This design system does not require a pixel-perfect recreation
of any reference site.

## 2. Design principles

1. **Analysis before decoration.** Identity, value, date, unit, source, cadence, and
   availability are easier to find than decorative elements.
2. **Dense on desktop, comfortable on touch.** Desktop surfaces may be compact;
   mobile and coarse-pointer controls retain readable line height and safe targets.
3. **Calm light surfaces.** Hierarchy comes from surface, border, typography, and
   spacing rather than gradients, glass effects, or large shadows.
4. **State is explicit.** Available, unavailable, partial, stale, fallback, warning,
   and error states have text or shape labels; color is never the only signal.
5. **Exact data remains available.** Every visual chart has an accessible exact-data
   path, normally a permanently available table.
6. **Local and durable.** Use local system fonts and repository-owned assets. The
   Dashboard must not depend on a design-site network request.

## 3. Design tokens

### 3.1 Color

These are the only base color tokens for new or migrated UI.

| CSS token | Role | Value |
| --- | --- | --- |
| `--color-canvas` | page canvas | `#F4F8FB` |
| `--color-surface` | primary surface | `#FFFFFF` |
| `--color-surface-muted` | secondary or grouped surface | `#F8FAFC` |
| `--color-border` | noninteractive structural border and chart grid | `#D6E1E8` |
| `--color-text-strong` | headings and primary values | `#0F172A` |
| `--color-text` | body text | `#334155` |
| `--color-text-muted` | metadata and unavailable text | `#475569` |
| `--color-accent` | primary action and selection | `#0369A1` |
| `--color-accent-active` | hover and active action | `#075985` |
| `--color-focus` | focus indicator | `#0369A1` |
| `--color-positive` | successful operation or explicitly contracted non-investment positive state | `#15803D` |
| `--color-warning` | partial, stale, fallback, or caution | `#B45309` |
| `--color-danger` | destructive action or error | `#B91C1C` |
| `--color-unavailable` | unavailable state | `#475569` |
| `--color-chart-price` | price line | `#0F172A` |
| `--color-chart-up` | observed up candle or series | `#0891B2` |
| `--color-chart-down` | observed down candle or series | `#E11D48` |
| `--color-chart-volume` | volume | `#64748B` |
| `--color-chart-rsi` | RSI and secondary purple series | `#7C3AED` |
| `--color-chart-macd` | MACD | `#0284C7` |
| `--color-chart-signal` | signal line | `#B45309` |

Component and chart aliases reuse those base tokens:

- interactive control borders use
  `--color-border-control: var(--color-text-muted)`;
- chart background is `--color-surface`;
- chart grid and scale borders use `--color-border`;
- chart axis labels and crosshair use `--color-text-muted`;
- SMA 20 uses `--color-accent`;
- Swing High uses `--color-warning`;
- Swing Low uses `--color-chart-rsi`;
- Radar uses an accent stroke and the same accent at 12% opacity for its fill; and
- Volume Profile uses volume for ordinary bins, accent for Value Area, and warning
  for Point of Control.

Status surfaces do not add a private pastel palette. They use
`--color-surface-muted`, the relevant semantic border, an explicit state label, and
normal body text. A semantic color may color the state label or leading border, but
not an entire paragraph of small text.

Positive and danger tokens do not imply investment quality. Chart up/down colors
represent an observed price direction only. Never convert them into Buy/Sell,
favorable/unfavorable, or forecast semantics.

Text and controls must meet WCAG 2.2 AA against their actual background. Meaningful
non-text shapes, chart lines, controls, and focus indicators must meet 3:1 contrast
against every adjacent surface. Chart-only tokens such as `--color-chart-macd` are
not body-text colors. If measurement fails, update the exact token here before the
implementation is merged.

### 3.2 Typography

No external font request is allowed.

| CSS token | Family |
| --- | --- |
| `--font-ui` | `Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif` |
| `--font-data` | `"SFMono-Regular", Consolas, "Liberation Mono", monospace` |

Use `--font-ui` for Japanese text, headings, controls, navigation, descriptions, and
long-form content. Use `--font-data` only for numbers, ticker symbols, IDs, dates,
compact metadata, and exact-value tables. The legacy near-global monospace treatment
is not part of the target system.

| Type role | Size / line height / weight | Family |
| --- | --- | --- |
| display | `32px / 40px / 700`; mobile `28px / 36px / 700` | UI |
| page heading | `24px / 32px / 700` | UI |
| section heading | `18px / 24px / 700` | UI |
| subsection heading | `16px / 24px / 600` | UI |
| body | `14px / 22px / 400` | UI |
| small body | `12px / 18px / 400` | UI |
| label and metadata | `11px / 16px / 600` | UI or data by content |
| table and exact data | `12px / 18px / 500` | data |
| KPI value | `24px / 32px / 600` | data |

Use tabular numerals for aligned financial values. Numeric columns align right;
identity and explanatory columns align left. Japanese labels are never transformed
to uppercase. Short Latin eyebrows may use `0.06em` letter spacing; body text and
numeric values do not.

### 3.3 Spacing, sizing, and shape

| CSS token | Value |
| --- | --- |
| `--space-1` | `4px` |
| `--space-2` | `8px` |
| `--space-3` | `12px` |
| `--space-4` | `16px` |
| `--space-6` | `24px` |
| `--space-8` | `32px` |
| `--radius-control` | `8px` |
| `--radius-surface` | `12px` |
| `--border-width` | `1px` |

Use only the spacing scale above for margin, padding, gap, and inset. Larger page
separation may be expressed as a whole-number multiple of an existing token, not as
an unrelated value. Border width, the 2px focus ring, and the 2px selected-tab
underline are intentional non-spacing geometry.

- Content width is at most `1500px`.
- Desktop outer gutter is `24px`; mobile outer gutter is `12px`.
- Standard card gap and desktop card padding are `24px`.
- Mobile card padding is `16px`.
- Standard controls are at least `40px` high.
- A `32px` compact control or data row is allowed only at `680px` and above with a
  fine pointer.
- Tabs are at least `48px` high.
- Below `680px`, or for a coarse pointer, every interactive target is at least
  `44px` by `44px`.
- Use the existing structural breakpoints at `980px` and `680px`.

Controls use the control radius. Cards, panels, dialogs, and other substantial
surfaces use the surface radius. Chart markers, radio controls, and other inherently
circular geometry are exempt; do not introduce pill-shaped decoration merely for
style.

### 3.4 Elevation and motion

Cards, tables, headers, and navigation use flat surfaces and borders. Do not use a
gradient, glass blur, glow, or large shadow for default hierarchy. Sticky regions
use an opaque surface and border rather than backdrop blur.

Dialogs alone may use:

- backdrop: `--color-text-strong` at 40% opacity; and
- overlay shadow: `0 24px 64px rgb(15 23 42 / 18%)`.

Only color, background-color, and border-color may transition for ordinary feedback,
with a maximum duration of `120ms`. Do not move or scale a control on hover. Do not
run a decorative animation continuously. Loading motion stops when
`prefers-reduced-motion: reduce` is active.

## 4. Visual hierarchy

Use this order unless a functional contract explicitly requires another:

```text
canvas
  common header and global navigation
  page identity, as-of/source metadata, and primary action
  sticky local tabs
  KPI or current-state summary
  primary analytical surface
  supporting cards
  exact tables, limitations, and source notes
```

One page has one visual page heading. Sections use a descending semantic heading
structure. A card title does not compete with the page title. Primary actions sit
with the identity or dataset they affect; secondary actions remain visually quieter.

`dataDate`, source, cadence, fallback, unavailable state, and proxy limitations stay
near the affected value. They are not hidden in a decorative footer, tooltip, color,
or chart-only legend. `market-overview` always presents `全市場共通` as persistent
identity text.

## 5. Component styling

### 5.1 Page shell, panels, and cards

- Canvas uses the canvas token; content surfaces use primary surface.
- A standard Card uses a 1px border, 12px radius, and no gradient or shadow.
- Use muted surface for a grouped subsection, table header, selected neutral row, or
  non-semantic background—not to imitate elevation.
- Card headers contain title, short context, and only actions owned by that card.
- Do not nest bordered cards repeatedly. Prefer spacing or one muted subsection
  inside a primary card.

### 5.2 Buttons and links

| Variant | Styling |
| --- | --- |
| primary | accent background, surface-token text, accent border |
| secondary | primary surface, interactive control border, body text |
| quiet | transparent background and accent text; retain a full target |
| destructive | danger background, surface-token text, danger border |
| disabled | muted surface, muted text, interactive control border, native disabled state |

Hover/active uses the accent-active token where applicable. Disabled state is not
communicated by opacity alone. Every interactive variant uses the common focus ring.
Inline links are underlined by default; hover and focus may strengthen the underline
and remain distinguishable from body text without relying only on color.

### 5.3 Form controls

Inputs, selects, and text controls use primary surface, interactive control border,
body text, control radius, and at least the standard control height. A visible label
precedes the control. Help and error text are programmatically associated. An invalid
control uses danger border plus an explicit error message; placeholder color or
border color alone is insufficient.

### 5.4 Tabs and navigation

Tabs use a primary surface. The selected tab has accent text, a 2px accent underline,
and the semantic selected state. Hover uses muted surface. The selection must remain
recognizable without color.

On narrow screens, tabs scroll inside their own labelled region, preserve a visible
edge cue, and scroll the selected tab into view. Do not shrink labels below the type
scale or create document-level horizontal overflow.

### 5.5 Tables

- Header cells use muted surface and label typography.
- Data rows use primary surface and the standard border.
- Desktop rows may be 32px high; touch layouts retain 44px interaction targets.
- Numeric values align right with tabular numerals; identities and explanations
  align left.
- Sticky headers are allowed inside a bounded table region.
- A wide table scrolls inside a keyboard-focusable, labelled container. The document
  itself must not overflow horizontally.
- Do not replace unavailable, zero, or corrected values with a visually ambiguous
  blank or dash.

### 5.6 Badges, alerts, and data states

Badges use muted surface, standard or semantic border, control radius, and label
typography. Alerts use the same surface family with a semantic leading border, a
state heading, and explanatory text. They do not introduce a separate decorative
palette.

Success, partial, stale, fallback, unavailable, warning, and error always include an
exact text label or icon-plus-label. A valid zero remains normal data. A fallback or
stale warning stays next to the retained value and does not erase it.

### 5.7 Dialogs

Use native `<dialog>` and the existing focus containment/return behavior. A dialog
uses primary surface, standard border, surface radius, the approved backdrop and
overlay shadow, and a sticky header when content scrolls. The close control remains
visible and has an accessible name and safe target.

### 5.8 Charts and exact tables

- Reuse the installed chart implementation and the approved chart tokens.
- Chart background is a primary surface; axes and grid are deliberately quieter than
  the data.
- Every series has a visible name and a non-color identifier in the legend or exact
  table.
- Price, Volume, RSI, and MACD panes may collapse independently but keep an accessible
  control and state.
- Crosshair values are also exposed through keyboard operation and exact text.
- A chart never hides missing, partial, fallback, cadence-break, or basis-break state.
- Radar and other SVG charts provide a semantic exact table permanently, not only on
  demand.
- Up/down candle color describes observed direction only and is not a recommendation.

### 5.9 Loading, empty, and error surfaces

Reuse one Card-based state surface with the same title and body hierarchy. Loading
has a textual status. Empty state explains what is absent and, when applicable, the
available next action. Error state names a safe recovery action. A refresh error
retains the last valid content and adds a warning instead of replacing it with an
empty page.

### 5.10 Icons and assets

Prefer text labels. Repository-owned SVG icons may be used at 16px inline or 20px in
a control, use `currentColor`, and carry an accessible name when icon-only. An icon's
visual box does not reduce its control's target. Do not use emoji as the sole status
or navigation symbol. Do not load an external font, image, icon set, or Refero asset.

## 6. Responsive behavior

- Above `980px`, use the compact multi-column analytical layout where content fits.
- From `680px` through `980px`, collapse complex multi-column surfaces before text or
  controls become cramped.
- Below `680px`, use the mobile gutter, mobile card padding, single-column primary
  flow, safe targets, and locally scrollable data regions.
- Coarse-pointer rules apply even on a wide viewport.
- Never reduce exact-data access, state labels, source/date metadata, or proxy
  limitations to make a layout fit.
- At 320px and above, the document has no horizontal overflow. Only explicitly
  labelled tables, tablists, or charts may scroll within their own region.

Required visual QA widths remain 320, 390, 680, 768, 980, 1024, and 1280px.

## 7. Accessibility and usability gates

- Normal text meets 4.5:1 contrast; qualifying large text meets 3:1.
- Meaningful non-text UI and chart shapes meet 3:1 against adjacent colors.
- `:focus-visible` uses a 2px focus token ring with a 2px outer offset. An inset ring
  is allowed only when clipping would otherwise hide the focus indicator.
- Status, direction, selection, and availability are not communicated by color alone.
- Keyboard, pointer, and touch users receive the same information and actions.
- Hover and crosshair are not the only paths to a value.
- Heading order, landmarks, control labels, table captions, live status, and dialog
  names remain semantic.
- Reduced-motion preference is honored.
- Japanese labels and long values wrap without covering actions or causing document
  overflow.

## 8. Reuse and migration

Reuse the current semantic and interaction structures before creating another
component:

- `Card`, `MetricGrid`, `AvailabilityBadges`, `Value`, and `GuidanceButton`, shared
  by `src/dashboard/web/app.tsx` through `src/dashboard/web/primitives.tsx`;
- `DashboardTabs` and `DashboardTabPanel` in `src/dashboard/web/app.tsx`;
- the existing table-scroll region, native glossary dialog, and loading/empty/error
  patterns;
- `lightweight-charts`, Peer Radar, Volume Profile, and their exact tables; and
- the existing History API, focus, and latest-request-wins behavior.

Reuse those components' responsibilities and accessibility behavior, not their
legacy dark appearance. The current dark palette, gradients, blur, large display
heading, scale-external spacing, near-global monospace, square surfaces, and
hard-coded chart colors are migration inputs—not approved values for new work.

Dashboard Refresh is staged. During migration, an untouched legacy surface may keep
its prior CSS until its planned step, but a new or migrated component uses only this
system. Do not mix legacy and new hard-coded visual values inside a migrated
component. DR-V1 establishes tokens and primitives; DR-V2 and DR-V3 migrate the
Watchlist and detail surfaces.

The DR-V1 implementation keeps the exact base tokens and their type/geometry/chart
aliases in `src/dashboard/web/design-tokens.css`. `primitives.css` implements the
light system inside the explicit `DashboardDesign` / `.dashboard-design` boundary.
It does not redefine the legacy variables or globally recolor unmigrated routes.
The boundary is a code-level migration tool, not a user theme option.

Shared foundation additions are native `Button` variants, text-labelled
`StatusBadge` / `StatusNotice`, and the named, keyboard-focusable `TableScroll`.
`Value` defaults to the UI family. Callers explicitly select `kind="data"` for
numbers, tickers, IDs, or dates; `MetricGridItem.valueKind` passes the same content
role through `MetricGrid`. Unavailable/uncollected values always use UI text even
when the available value's role is data. Never infer a role from a formatted string,
its label, or whether it resembles a number. `Value` retains its containing type
size; `MetricGrid` uses small-body text for state/category values and exact-data
typography for explicitly selected data values. Availability semantics are unchanged.

`design-metadata` is UI label/metadata typography by default, including Japanese
metadata. Its explicit `data-kind="data"` variant is only for compact data such as
an ID or date, not Japanese explanations. Split mixed metadata into labelled text
and a data span rather than applying monospace to a whole sentence.

Table cells default to left-aligned small-body UI text. Apply `numeric-cell` to both
the header and body cells of a numeric column: the header retains UI label typography,
while available body numbers use right-aligned exact-data typography with tabular
numerals. Use `Value` for unavailable/uncollected placeholders in numeric cells so
their text keeps the UI family. Identity and explanatory columns remain left-aligned;
an explicitly data-typed `Value` can render a ticker/ID without changing alignment.
`identity-cell` is an optional identity-emphasis alias, not an escape hatch required
for explanatory text.

The `design-field` rectangular-control pattern covers only native select/textarea
and text-like inputs: omitted type, `text`, `search`, `email`, `url`, `tel`,
`password`, `number`, `date`, `datetime-local`, `month`, `week`, and `time`.
It requires a visible label and associated help/error text. Checkbox, radio, range,
color, file, hidden, and button-like inputs are outside this pattern; none of its
control geometry, invalid, disabled, or touch-sizing rules apply to them. Their
complete accessible patterns remain part of the owning surface's migration, not an
implicit rectangular-input fallback.

`design-content`, `design-stack`, and `design-actions` apply the sizing and spacing
above; `--type-*` and named control/focus/dialog aliases encode only the existing
roles and geometry. These are implementation names, not another visual authority
or a second design scale.

DR-V1 tests the light primitives in a test-only composition while production routes
continue to use their legacy appearance and the same shared semantic components.
DR-V2 opts in the complete Watchlist surface; DR-V3 opts in the complete detail
surface, including its charts, tables, dialog, and tabs. Do not put an unmigrated
complex surface inside the light boundary. Chart palette aliases are available in
DR-V1, but applying them to the existing chart runtimes remains DR-V3 work.

## 9. Change checklist

For every user-facing UI task:

1. Read `DESIGN.md`, `docs/SPEC.md`, and the applicable plan before deciding the
   visual approach.
2. Inventory reusable tokens and components before adding anything.
3. Map every color, type, spacing, radius, component state, and hierarchy choice to
   this file.
4. If a required choice is missing, amend this file and review that amendment before
   implementation; do not invent a local exception.
5. Verify contrast, focus, keyboard, touch targets, reduced motion, overflow, and
   exact-data access at the applicable widths.
6. Confirm that product meaning, accessibility, usability, and functional accuracy
   were not weakened for visual similarity.

Dark mode, automatic OS-theme switching, a theme picker, external design assets,
pixel-perfect reference-site reproduction, and color-derived investment signals are
not part of this design version.
