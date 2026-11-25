# Benchmark UI Design and Implementation Handbook

Version 2.0 · 25 November 2026 · Garden study, from [UI_DESIGN_WORKBOOK.html](UI_DESIGN_WORKBOOK.html) v3.0

Use this handbook to build Doc Search Benchmark and related SetSail web apps in the **garden study**. Its sources are the asylum garden (1889) and Reminiscence of Brabant (1890), with a touch of Boulevard de Clichy (1887):

- **Brabant** gives the sage ground and its ochre contours.
- **The garden** gives the violet working colour and the red earth.
- **Clichy** gives short broken ticks.

The brushwork sits around the work, never under it.

The workbook is the design source and an interactive worksheet: live token editor, contrast check and acceptance checklist. This handbook records the standard as it is built in this app. The earlier ivory/blue theme (v1.0) is kept unchanged as [Appendix A](#appendix-a-ivoryblue-theme-v10). Either is valid for a related app, provided the choice is recorded as a deliberate departure.

## Contents

1. [Brand standard](#brand-standard)
2. [Colour system](#colour-system)
3. [Typography and icons](#typography-and-icons)
4. [Layout and responsive behaviour](#layout-and-responsive-behaviour)
5. [Component specifications](#component-specifications)
6. [Brushwork system](#brushwork-system)
7. [States and data honesty](#states-and-data-honesty)
8. [Current implementation map](#current-implementation-map)
9. [Adopting the brand in another app](#adopting-the-brand-in-another-app)
10. [Acceptance checklist and verification](#acceptance-checklist-and-verification)
11. [Product definition and departures](#product-definition-and-departures)
12. [Maintenance and known gaps](#maintenance-and-known-gaps)
13. [Appendix A: ivory/blue theme (v1.0)](#appendix-a-ivoryblue-theme-v10)

## Brand standard

The interface should feel calm, capable and human. The garden is atmosphere; the chalk wall is the work.

- **Clarity first.** Keep navigation persistent and page identity clear. Give each task area one prominent action and keep work surfaces readable.
- **Honest data.** Show limitations and failures beside the figures they qualify. Never hide a denominator.
- **Reserved semantics.** Red, green and amber mean labelled states. Ochre contour, lavender, sage and red earth do not.
- **Stable while working.** Loading must not reshuffle imagery or move the main action. Nothing animates.
- **Accessible by default.** Keyboard access, visible focus, labelled controls and sufficient contrast are requirements, not extras.
- **Few consistent decisions.** The identity is the sage ground, the violet action, the ochre contour and the serif nameplate. Controls carry no brushwork.

Avoid these:

- brushwork behind tables, forms or type
- ochre as text or as a control label
- broken colour used as a button style
- animated paint
- more than one tick mark per block
- red earth used to suggest failure

## Colour system

All values are custom properties in the `:root` block of [app/globals.css](app/globals.css). No raw colour appears outside that block, so a theme change is a token change. Do not sample chart series, status colours or button fills from a painting at runtime.

### Core tokens

| Token                                      | Value                     | Role                                                    |
| ------------------------------------------ | ------------------------- | ------------------------------------------------------- |
| `--color-bg`                               | `#d6d9c6`                 | Brabant sage ground, under a linen `--weave`            |
| `--color-surface`                          | `#faf6ea`                 | Chalk wall: panels, sidebar, top bar, dialogs, plaques  |
| `--color-surface-sunk`                     | `#f3efe1`                 | Inset areas: dropzone, dialog footer, `pre`, notes      |
| `--color-field`                            | `#fffdf7`                 | Input, select and textarea fill                         |
| `--color-table-head`                       | `#eef0e4`                 | Table and card headers                                  |
| `--color-text`                             | `#2c2a33`                 | Violet-black ink (garden trunk outlines)                |
| `--color-muted`                            | `#4b5244`                 | Supporting copy                                         |
| `--color-line`                             | `#7b806c`                 | Field borders and strong rules (~3.8:1 on chalk)        |
| `--color-line-panel` / `--color-line-soft` | `#7b806c80` / `#7b806c4d` | Panel borders / dividers                                |
| `--color-action`                           | `#443c6b`                 | Garden violet: primary buttons, links, selection, focus |
| `--color-action-hover`                     | `#332c56`                 | Primary hover                                           |

### State tokens (always paired with text)

| State   | Foreground | Background | Used for                                        |
| ------- | ---------- | ---------- | ----------------------------------------------- |
| Success | `#2f5d3a`  | `#e5eedb`  | succeeded, completed, pass                      |
| Active  | `#443c6b`  | `#ebe7f3`  | active, running; info alerts                    |
| Warning | `#6b4b0c`  | `#f6ecc9`  | queued, pending, review; cautions               |
| Danger  | `#8a2a1d`  | `#f8e4dc`  | failed, fail, interrupted, error                |
| Neutral | `#4b5244`  | `#eae6d8`  | every other value, e.g. skipped, not applicable |

Success green is darker than the garden foliage. Failure crimson is darker and cooler than red earth and always says "Failed".

### Decorative accents (no status meaning)

`--d1` ochre contour `#d1a93a`, `--d2` lavender `#9690c4`, `--d3` sage `#7f9a7a`, `--d4` red earth `#a2432a`. They are assigned by position: metric bands, painted fields, footer. Ochre on chalk is about 2:1, so it is only ever a line.

### Chart tokens

The tokens ship ready, but no screen draws a chart yet.

- **Series:** `--series-1` … `--series-8` are used in fixed order and never cycled. A ninth series folds into "Other". Scatter plots, maps and small multiples use slots 1–3 only. Slots 3 (ochre) and 7 (olive) are under 3:1, so any chart using them needs direct labels or a table view.
- **Scales:** `--seq-*` (violet) for magnitude and `--seq2-*` (red earth) for a second magnitude scale. Diverging scales run violet ↔ red earth through `--div-mid`.
- **Status marks:** `--status-good|warning|serious|critical`, always with an icon and label, never as a series.
- **Chart surface and ink:** `--chart-*`.

### Contrast

Normal text needs 4.5:1. Large text and meaningful UI components need 3:1.

| Pair                    | Ratio       |
| ----------------------- | ----------- |
| Text on the sage ground | about 9.8:1 |
| White on garden violet  | about 9.9:1 |
| Field border on chalk   | about 3.8:1 |

The axe checks in [tests/ui/garden-study.spec.ts](tests/ui/garden-study.spec.ts) cover rendered colour contrast on every route at 1440 and 390px. Recheck any new state combination or opacity.

## Typography and icons

| Role                | Specification                                                                                                       |
| ------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Page title (H1)     | `--serif` 46px / 400, −1.2px. Steps: 40px ≤1150, 38px ≤900, 32px ≤650                                               |
| Section (H2)        | `--serif` 19px / 600. Dialog titles 22px / 400                                                                      |
| Body                | System sans 14px / 1.55                                                                                             |
| Control             | 13px / 600                                                                                                          |
| Supporting          | 12px, `--color-muted`. Essential copy is never smaller                                                              |
| Metric              | `--serif` 38px, `tabular-nums lining-nums`                                                                          |
| Eyebrow and caption | `--serif` italic 14px, muted, preceded by Clichy ticks. Used for eyebrows, table heads, detail labels, card kickers |
| Mono                | `--mono` 12px                                                                                                       |

`--serif` is the Iowan Old Style / Palatino / Georgia stack. No remote fonts are loaded. Eyebrows are written in sentence case and only supplement a full title.

Icons are Lucide (one stroke family): about 18px in navigation and 15–17px on actions. Decorative icons are `aria-hidden`. An icon never replaces its text label, except in the ≤650px icon rail, where every link keeps an `aria-label`.

## Layout and responsive behaviour

[components/shell.tsx](components/shell.tsx) is mounted once in [app/layout.tsx](app/layout.tsx):

- **Skip link** to `main#main-content`.
- **Fixed chalk sidebar:** sunmark and serif nameplate, an italic "Workspace" label, three navigation links, a workspace note, and a footer.
- **Top bar:** breadcrumb and environment chip, with the ochre contour beneath.
- **Main:** max-width 1540px.
- **Footer:** chalk text band under a contour, above a 48px painted red-earth strip.

The `/cms/approve` route skips the shell entirely.

| Viewport | Behaviour                                                                                                               |
| -------- | ----------------------------------------------------------------------------------------------------------------------- |
| ≥1500px  | Roomier top padding; wider upload column; taller dropzone                                                               |
| >1150px  | Sidebar 220px (`--sidebar-width`); top bar 65px; main padding 40px                                                      |
| ≤1150px  | Sidebar 206px; main padding 32/25px; H1 40px                                                                            |
| ≤900px   | Upload panels stack; metric grid becomes 2 columns; comparison answers stack; H1 38px                                   |
| ≤650px   | Icon rail 60px (active link filled violet); top bar 57px; heading plaque full width under a 52px painted strip; H1 32px |

The sidebar width and main offset share one variable, so they cannot drift apart. The spacing rhythm is 4px. Wide tables scroll inside a focusable, labelled region and never shrink type to fit. `.table-wrap` is `position: relative` so visually hidden labels inside a scrolled table cannot widen the page.

## Component specifications

### Page identity

[PageHeading](components/page-heading.tsx) keeps its v1 props: `eyebrow`, `title`, `description` and an optional `action`. It renders a painted field (`.page-heading-paint`) behind a chalk plaque (`.page-heading-content`) that carries the eyebrow, the single H1, the description and the action. The plaque is opaque and has an ochre contour on its top edge. A page using it must not add another H1.

```tsx
<PageHeading
  eyebrow="Your reporting workspace"
  title="Customer reports"
  description="Review service performance and identify cases that need attention."
  action={
    <Link className="button primary" href="/reports/new">
      <Plus size={17} aria-hidden="true" /> Create report
    </Link>
  }
/>
```

### Panels and metrics

- **`.panel`:** chalk, a `--color-line-panel` border, uneven `--radius-panel` corners and `--shadow`. It adds no padding; use `.panel-title` and `.panel-body` (22px).
- **`.metric-grid`:** four columns (two at ≤900px).
- **`.metric`:** a label row with an icon, a 38px serif value, and a `small` supporting line that carries the denominator, e.g. "of 221 questions". The painted band at the top of each card is ochre, lavender, sage or red earth by position and says nothing about the figure.

### Buttons and controls

| Class               | Specification                                                                  |
| ------------------- | ------------------------------------------------------------------------------ |
| `.button.primary`   | Garden violet, white text, thin ochre lip (`--shadow-button-primary`)          |
| `.button.secondary` | Chalk, `--color-line` border, ink text                                         |
| `.button.small`     | 12px, minimum height 32px                                                      |
| `.icon-button`      | Minimum 32px square, transparent, violet tint on hover; must have `aria-label` |
| `.link-button`      | A button that reads as a link, e.g. the record query                           |
| `.text-button`      | Violet text link with an icon                                                  |

Base buttons are 13px / 600, minimum height 42px, with uneven `--radius-button` corners.

- **Hover** rules use `:not(:disabled):not([aria-disabled="true"])`, so `a.button` and `button.button` behave the same.
- **Disabled:** `aria-disabled` links are inert (`pointer-events: none`) and dimmed.
- **Links and buttons:** links navigate; buttons act. Non-submit buttons carry `type="button"`.
- **In progress:** in-progress text ("Starting…", "Queuing…") replaces the label and blocks duplicate submits.

Fields share one rule:

- `--color-line` border and `--color-field` fill, with `--radius-field` corners.
- Minimum height 38px.
- Never outlined in ochre.
- Checkboxes and radios use `accent-color: var(--color-action)`.

**Focus** everywhere is a 3px violet outline, offset 3px, plus a soft ochre halo. The outline is the indicator.

### Status and feedback

`Badge` in [components/common.tsx](components/common.tsx) maps values through an explicit table (`badgeTone`) to `success | active | warning | danger | neutral` and formats the label with `statusLabel`. Unknown values render neutral. Add a new status to the table on purpose rather than relying on a class name. Dimension results use the same `Badge`.

- **`ErrorBox`** renders `.alert.error` with `role="alert"`.
- **`.alert.warning` and `.alert.info`** use the matching state tokens with a 4px left rule.
- **`.quiet-note`** is a neutral inset tip.

### Tables and disclosure

- **Wrapper:** `.table-wrap` with `role="region"`, an `aria-label` and `tabIndex={0}`.
- **Headers:** `th scope="col"` in italic serif on `--color-table-head`. Body text is ink; `small` lines are muted.
- **Rows are not click targets.** In Records, details open from the query (`.link-button`) or a labelled chevron `.icon-button`.
- **Diagnostics** go in native `details`.
- **No brushwork** under the figures.

### Dialogs

`Modal` uses a native `dialog` with `showModal()`:

- The title and description are associated with the dialog, and focus moves to the close button.
- Escape and backdrop clicks call `onClose`.
- On close, focus returns to the opener. If the opener could not take focus back (for example, it was disabled while a CSV was read), focus goes to the optional `returnFocus` ref instead.
- **Surface:** chalk under an ochre contour, with a `--color-surface-sunk` footer.
- **Size:** desktop `min(1100px, 94vw)` × 92vh; mobile 97vw × 96vh. The body scrolls.

Whether a dialog may close mid-operation is the caller's decision.

## Brushwork system

| Mark          | Where                                                                                                   | Source                                                                                            |
| ------------- | ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Painted field | Page heading (`hero`) and footer strip (`foot`)                                                         | [lib/painter.ts](lib/painter.ts) via [components/painted-field.tsx](components/painted-field.tsx) |
| Ochre contour | Under the top bar, on heading plaques, dialog heads, the footer band, metric bands, the approval plaque | `--contour` (SVG data URI)                                                                        |
| Clichy ticks  | Before eyebrows and the sidebar "Workspace" label; one per block                                        | `--ticks`                                                                                         |
| Linen weave   | Page ground only                                                                                        | `--weave`                                                                                         |

The painted field is generated from the palette, not cut from a painting:

- **What it paints:** Brabant swirls in the sky, ochre contours on the clouds, a low sun at the right, garden dashes on the red earth, and a scatter of Clichy ticks.
- **Seeding:** a mulberry32 generator seeded from the route path (`seedFor(pathname)`), so each page paints the same on every visit. The footer uses a fixed seed.
- **Performance:** fields are cached per mode, seed, size and device-pixel ratio, and repaint only on a debounced resize.
- **Loading and access:** the canvas is `aria-hidden` and sits on a flat `--color-hero-ground` fallback, so loading shifts no layout.
- **No animation,** whatever the user's motion setting.

**Rollback flag.** `NEXT_PUBLIC_HEADER_IMAGERY=rotating` restores the v1 rotating Google Art Project catalogue behind the plaque for one release. That code is [components/artwork-header.tsx](components/artwork-header.tsx), [lib/artwork.ts](lib/artwork.ts), [lib/artwork-catalog.json](lib/artwork-catalog.json) and [public/art](public/art); see Appendix A, "Artwork system". Remove the flag and that code once the generated field has been accepted. The workbook's three "(If rotating)" checklist items apply only while the flag is in use.

Reference images for the workbook live in `impressionst_ref/previews/`. They are references, not product assets, and are excluded from Vercel uploads.

## States and data honesty

Loading, empty, failed, unavailable and zero are different states. Never turn a failed request into a reassuring empty state.

| State       | Pattern in this app                                                                                      |
| ----------- | -------------------------------------------------------------------------------------------------------- |
| Loading     | `role="status"` text ("Loading runs…"); metrics show "—" with "Loading…"                                 |
| Empty       | `.empty-state` with the next action ("No runs yet" → Upload questions)                                   |
| No match    | "No matching records" only while a filter or search is active                                            |
| Failed      | `.empty-state.failed` with the error, a recovery hint and **Retry**; metrics show "—" with "Unavailable" |
| Stale       | A later poll failure keeps the last data and shows `ErrorBox` above it                                   |
| Unavailable | "—" with a reason, e.g. "Unknown sources", "Trace ID unavailable"                                        |
| Zero        | `0` is a real value and is shown as `0`                                                                  |

Metric definitions come from `summarize()` in [lib/schema.ts](lib/schema.ts). The UI shows each denominator beside its figure:

| Figure              | Definition                                                             | Shown as                                                                    |
| ------------------- | ---------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| Pass rate           | Passed ÷ (passed + failed). Suppressed across mixed evaluator policies | "N of M eligible passed", with "review · unassessable excluded" beneath     |
| Coverage            | Requirement-evaluated records ÷ all records                            | "Requirement coverage of N records"                                         |
| Average latency     | Successful search requests only                                        | "N successful requests"                                                     |
| Operational success | Successful searches ÷ all records                                      | "N of M records"                                                            |
| Run metrics         | Summed across runs                                                     | "of N questions" (successful answers), "of N graded" (cases needing review) |

`percent()` expects a 0–100 value, `latency()` expects milliseconds, and both return "—" for null.

## Current implementation map

| Source                                                         | Responsibility                                                                                                                                         |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [app/globals.css](app/globals.css)                             | Tokens, then base, shell, page identity, components, screens and breakpoints, in numbered sections. One block per breakpoint; no later override layers |
| [components/shell.tsx](components/shell.tsx)                   | Nameplate, navigation and icon rail, top bar, footer with painted strip                                                                                |
| [components/page-heading.tsx](components/page-heading.tsx)     | Painted field plus chalk plaque; rollback flag                                                                                                         |
| [components/painted-field.tsx](components/painted-field.tsx)   | Canvas lifecycle, palette from CSS tokens, bitmap cache, resize repaint                                                                                |
| [lib/painter.ts](lib/painter.ts)                               | Seeded brushwork (`rng`, `seedFor`, `paintField`)                                                                                                      |
| [components/common.tsx](components/common.tsx)                 | `Badge` / `badgeTone` / `statusLabel`, `Modal` (with `returnFocus`), `ErrorBox`, `CopyButton`, formatters                                              |
| [components/runs.tsx](components/runs.tsx)                     | Run metrics with denominators, states, run table and disclosures                                                                                       |
| [components/records.tsx](components/records.tsx)               | Filters, states, record table (rows not clickable), record dialog                                                                                      |
| [components/upload.tsx](components/upload.tsx)                 | Upload, review dialog, recent runs with loading and failed states                                                                                      |
| [tests/garden-study.test.ts](tests/garden-study.test.ts)       | Badge tone map and painter determinism                                                                                                                 |
| [tests/ui/garden-study.spec.ts](tests/ui/garden-study.spec.ts) | Browser acceptance checks (see below)                                                                                                                  |
| [scripts/ui-screenshots.mjs](scripts/ui-screenshots.mjs)       | Full-page screenshots of every route at 1440, 900 and 390px                                                                                            |

The stack is Next.js 16.4.5 App Router, React 19.3.1, TypeScript, plain global CSS and Lucide icons, with no UI framework. Read `node_modules/next/dist/docs/` before changing framework behaviour.

## Adopting the brand in another app

1. Fill in the workbook's §2 Product definition: product name, primary task, key decision metrics and deliberate departures.
2. Copy the `:root` token block from `app/globals.css`, or use the workbook's "Copy token CSS" button, which gives the same core values. Keep raw colours inside `:root`.
3. Copy `lib/painter.ts`, `components/painted-field.tsx`, `components/page-heading.tsx` and the shell, then replace routes, labels and metadata.
4. Bring the component sections (buttons, badges, alerts, metrics, tables, dialog, states) with their accessibility rules.
5. Define the new product's metrics separately, but keep the denominator-beside-figure rule.
6. Run the Playwright spec, adapted to the new routes, and tick the workbook checklist.

> **Brief:** Build this app in the garden study from the Benchmark UI handbook v2.0.
>
> - Sage ground `#d6d9c6` with a linen weave, and opaque chalk surfaces `#faf6ea`.
> - Ink `#2c2a33` and garden violet `#443c6b` for actions, links and focus.
> - Ochre contour `#d1a93a` only as a line, under bars and on plaques.
> - An Iowan/Palatino serif for titles, eyebrows and table heads; system sans for controls and data.
> - A seeded, static painted field behind a chalk plaque on each page heading, and a thin painted footer. No brushwork under tables, forms or figures.
> - Explicit status tones with text, denominators beside percentages, and distinct loading / empty / failed / unavailable / zero states.
> - Keyboard access, an icon rail at ≤650px, and no page overflow at 375px.

## Acceptance checklist and verification

The full checklist is §12 of the workbook, and progress is saved in the browser. `pnpm test:ui` runs the Playwright spec. It uses `UI_BASE_URL`, or starts `next dev` on port 3100 itself, and only reads workspace data.

Status at version 2.0 (25 November 2026):

| Check                                                                                               | How                                               | Status                    |
| --------------------------------------------------------------------------------------------------- | ------------------------------------------------- | ------------------------- |
| No horizontal page overflow at 1440, 1151/1150, 901/900, 651/650, 390 and 375px, on all four routes | Playwright                                        | Passing                   |
| One H1 per page                                                                                     | Playwright                                        | Passing                   |
| No serious or critical WCAG 2.1 A/AA axe violations, including contrast, at 1440 and 390px          | Playwright + axe-core                             | Passing                   |
| Skip link first; moves focus to main                                                                | Playwright                                        | Passing                   |
| Icon rail links keep accessible names                                                               | Playwright                                        | Passing                   |
| Decoration `aria-hidden`                                                                            | Playwright                                        | Passing                   |
| Dialog: close button focused, Escape closes, focus restored                                         | Playwright                                        | Passing                   |
| A failed request shows the failed state, not "No runs yet"                                          | Playwright (mocked 500)                           | Passing                   |
| Record rows are not click targets                                                                   | Playwright                                        | Passing                   |
| No ochre used as text; no raw colours outside `:root`                                               | Source check                                      | Passing                   |
| 200% zoom                                                                                           | Covered approximately by the 650 and 900px widths | Recheck in a real browser |
| Long titles and captions wrap without covering controls                                             | Screenshots                                       | Spot-checked              |

## Product definition and departures

| Field                 | Doc Search Benchmark                                                                                                                                                                                                                                                                                                                                                                         |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Product               | Doc Search Benchmark                                                                                                                                                                                                                                                                                                                                                                         |
| Primary task          | Run a CSV of questions against Doc Search, then inspect and grade the answers                                                                                                                                                                                                                                                                                                                |
| Key decision metrics  | Pass rate (of eligible), requirement coverage, successful answers, cases needing review, average latency                                                                                                                                                                                                                                                                                     |
| Deliberate departures | **Heading height:** a 212px heading band instead of the workbook's ≥460px hero, because this is a working app. **Sun position:** the low sun sits at the right so the plaque never covers it. **Footer strip:** 48px instead of 90px. **Phone navigation:** icon rail rather than a drawer. **Rotating art:** the old catalogue is kept behind `NEXT_PUBLIC_HEADER_IMAGERY` for one release. |

## Maintenance and known gaps

- **Light only.** Chart and state steps are validated only on the chalk surface. A dark theme needs its own validated tokens, not an automatic flip.
- **No charts yet.** The chart tokens exist, but no screen draws a chart.
- **Rollback flag.** `NEXT_PUBLIC_HEADER_IMAGERY` and the rotating catalogue code are temporary. Remove them and `tests/artwork.test.ts` together.
- **No packaging.** There is no shared token package or component catalogue. The workbook is the visual catalogue.
- **Prettier.** `components/dimension-editor.tsx` has formatting drift that predates this revision.

When the brand changes, update the workbook, `:root` and this handbook in the same revision.

---

## Appendix A: ivory/blue theme (v1.0)

> This is the v1.0 handbook (22 November 2026, baseline `2b934db`), kept unchanged for apps that keep the ivory/blue theme. It no longer describes this app's live styling. File references below describe the v1 code: `app/globals.css` and the components have since been rewritten, and the artwork system survives only behind `NEXT_PUBLIC_HEADER_IMAGERY=rotating`.

Use this handbook to build related SetSail web apps with the visual identity established by Doc Search Benchmark: warm ivory workspaces, dark blue controls, restrained serif headings, and Impressionist artwork around precise analytical interfaces. Product names, navigation, and workflows can change; these visual and interaction principles should remain recognisable.

The **Brand standard** sections define what related apps should preserve. **Current implementation** sections record the working benchmark app. **Adoption guidance** describes how to reuse or improve it. This is a repository design reference, not an installed component package.

### Brand standard

The interface should feel calm, capable, and human. Artwork provides atmosphere; controls and data provide clarity. Use a familiar SaaS layout with a persistent navigation area, clear page identity, one prominent action per task area, and readable surfaces for work.

Preserve these rules across products:

- Use warm ivory for the workspace and near-white for content panels.
- Use dark water blue for primary actions, selection, and meaningful links.
- Pair restrained serif page titles with sans-serif controls and body text.
- Place Impressionist artwork in an isolated page-header region. Keep text beside it, on an opaque surface.
- Keep tables, forms, scores, and evidence panels free of paintings and textures.
- Use muted sage, lilac, and peach accents sparingly. These decorative accents carry no success or failure meaning.
- Reserve red, green, and amber for clearly labelled states.
- Show limitations and failures beside the figures they qualify.

For example, a related customer-support analytics app can use the same ivory shell, blue “Create report” action, serif page title, and painted header. Its ticket table should remain flat and legible, with explicit “Overdue” labels rather than decorative colours suggesting urgency.

Avoid full-screen paintings behind dashboards, pastel body text, distressed fonts, hand-drawn controls, animated brushstrokes, glass effects over evidence, and large promotional banners above routine work. The brand comes from a few consistent decisions, not decoration on every component.

### Colour system

#### Current implementation

These variables are defined in [app/globals.css](app/globals.css). Copy the values exactly when establishing a related app.

| CSS variable    | Value                  | Role                                         |
| --------------- | ---------------------- | -------------------------------------------- |
| `--blue`        | `#355f87`              | Primary controls, selected navigation, links |
| `--blue-dark`   | `#284a6b`              | Primary button hover                         |
| `--text`        | `#263449`              | Main text and metric values                  |
| `--muted`       | `#626e79`              | Supporting copy and table text               |
| `--line`        | `#dedfd9`              | Borders and separators                       |
| `--bg`          | `#f7f5ef`              | Workspace canvas                             |
| `--surface`     | `#fffefa`              | Cards, navigation, page headers              |
| `--accent-soft` | `#eaf0ef`              | Selected and active surfaces                 |
| `--green`       | `#226850`              | Success text                                 |
| `--red`         | `#a43939`              | Failure text                                 |
| `--shadow`      | `0 4px 20px #26344905` | Very subtle card elevation                   |

Additional values currently live in component rules rather than root variables:

| Usage                                | Foreground or accent                       | Background                  |
| ------------------------------------ | ------------------------------------------ | --------------------------- |
| Success badge                        | `#226850`                                  | `#eaf7f2`                   |
| Failure badge                        | `#a43939`                                  | `#fff0ee`                   |
| Pending badge and evaluation caution | `#84621e`                                  | `#fbf5e8` for badges        |
| Active badge                         | `#355f87`                                  | `#eaf0ef`                   |
| Neutral badge                        | `#626e79`                                  | `#f0f3f7`                   |
| Secondary button                     | `#40536a`                                  | `#ffffff`; border `#cbd1cd` |
| Keyboard focus                       | `#5c7e98`                                  | 3px outline with 3px offset |
| Decorative metric accents            | `#9aafbd`, `#9caa90`, `#aaa0b9`, `#c3a58f` | Near-white card             |

The metric accents are assigned by card position using `:nth-child`. A sage accent on the second card does not mean that metric is successful.

#### Brand standard

Keep the primary action and text colours stable while individual paintings change. Do not derive live chart series, status colours, or button colours from the current painting. Charts need stable, distinguishable series colours and labels across visits.

Calculated contrast for representative pairs is approximately 12.46:1 for main text on the panel surface, 4.78:1 for muted text on ivory, and 6.69:1 for white on primary blue. Those pairs meet the WCAG AA normal-text threshold of 4.5:1. Recheck new combinations, opacity, and text over images; these figures do not certify the entire app.

### Typography and icons

#### Current implementation

No remote fonts are loaded. The app uses the operating system sans-serif stack and a local serif stack.

```css
body {
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  font-size: 14px;
  line-height: 1.5;
}
h1 {
  font-family: Georgia, "Times New Roman", serif;
  font-size: 38px;
  font-weight: 400;
  letter-spacing: -1px;
  line-height: 1.25;
}
code,
.mono {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 12px;
}
```

| Element                              | Effective size and treatment                                                         |
| ------------------------------------ | ------------------------------------------------------------------------------------ |
| Shared page title                    | 38px desktop; 34px at widths up to 1150px; 30px within the shared header up to 650px |
| Header description                   | 14px; 13px up to 650px; line height 1.6                                              |
| Header eyebrow                       | 10px, weight 700, uppercase; letter spacing 1.8px desktop and 1.2px mobile           |
| Section titles in panels             | 16px, sans-serif                                                                     |
| General H2 and H3                    | 17px and 15px respectively; component rules can override                             |
| Format help panel title              | 24px, Georgia, weight 400                                                            |
| Body                                 | 14px                                                                                 |
| Buttons and table body               | 13px; compact buttons 12px                                                           |
| Supporting labels and table headings | Generally 12px                                                                       |
| Metric values                        | 32px; 28px up to 650px; tabular numerals                                             |
| Pass rate and coverage values        | 18px; tabular numerals                                                               |
| Artwork caption                      | 12px; 11px up to 900px                                                               |

Icons come from `lucide-react`. Navigation icons are 18px; action icons commonly use 15–17px. Keep stroke icons visually consistent. An icon supporting a text label should not replace that label except in compact navigation or a clearly named icon control.

#### Brand standard

Use serif typography for page identity and occasional editorial help headings. Use sans-serif for task instructions, controls, tables, and long explanations. Keep essential supporting copy at least 12px. Eyebrows may be smaller because they supplement a full title; never place essential instructions only in an eyebrow.

### Layout and responsive behaviour

#### Current implementation

The workspace combines `Shell`, `PageHeading`, and page-specific content. `Shell` is mounted once by the root layout; pages supply their content inside its `main` landmark.

| Viewport         | Effective layout                                                                                                          |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Above 1150px     | Fixed 222px sidebar; content starts at the same offset; topbar 65px high; main padding 43px 40px 36px                     |
| 1150px and below | Sidebar and content offset 206px; main padding 32px 25px; shared title 34px                                               |
| 900px and below  | Header artwork stacks below text; upload panels stack; metric grid becomes two columns                                    |
| 650px and below  | Sidebar becomes a 60px icon rail; content offset 60px; topbar 57px high; main padding 30px 16px; shared header title 30px |
| 1500px and above | Main top padding becomes 50px; upload dropzone minimum height becomes 300px                                               |

The main container has a maximum width of 1540px. The mobile navigation is an icon rail, not a drawer. Link `aria-label` values preserve navigation names when visible text is hidden.

The shared header has a 216px minimum height, a 16px radius, a 1px border, and a 30px bottom margin, reduced to 23px on mobile. Its desktop column definition is `minmax(0, 1.5fr) minmax(220px, 1fr)`. Up to 1150px it becomes `minmax(0, 1.6fr) minmax(180px, 1fr)`. Up to 900px it becomes one column. Header content padding is 30px 32px, then 26px, then 23px 20px on mobile.

Artwork uses a cover crop at `center 55%`. The stacked version uses `center 60%` with a minimum height of 100px, reduced to 82px on mobile. Review crops whenever adding a painting: the header is a decorative crop, not a reproduction of the complete composition.

#### Adoption guidance

Use an approximately 4px spacing rhythm for new components: 4, 8, 12, 16, 20, 24, 32, and 40px. This is guidance for new work, not an existing spacing-token API; the current CSS also uses values such as 18, 21, and 23px.

Keep horizontal scrolling inside wide tables. The Runs table has a minimum width of 1020px and the Records table 1050px. Preserve usable type rather than shrinking whole tables to fit a phone. Check the page itself for overflow at 375px and 390px widths. The current metric grid stays at two columns on mobile; a new app may use one column if labels require more room.

### Component specifications

#### Page identity

Reuse [PageHeading](components/page-heading.tsx) rather than duplicating its structure.

| Prop          | Type        | Required | Purpose                           |
| ------------- | ----------- | -------- | --------------------------------- |
| `eyebrow`     | `string`    | Yes      | Short context above the title     |
| `title`       | `string`    | Yes      | The page H1                       |
| `description` | `string`    | Yes      | One clear statement of the task   |
| `action`      | `ReactNode` | No       | Primary or supporting page action |

This example uses the current API after the shared components and stylesheet have been copied or made available:

```tsx
import Link from "next/link";
import { Plus } from "lucide-react";
import { PageHeading } from "@/components/page-heading";

export function ReportsHeading() {
  return (
    <PageHeading
      eyebrow="YOUR REPORTING WORKSPACE"
      title="Customer reports"
      description="Review service performance and identify cases that need attention."
      action={
        <Link className="button primary" href="/reports/new">
          <Plus size={17} /> Create report
        </Link>
      }
    />
  );
}
```

A page using this component should not add a second H1. The artwork is handled by its child `ArtworkHeader`.

#### Panels and metrics

`.panel` provides the near-white background, 1px border, 14px radius, and subtle shadow. It does not provide universal internal padding. `.upload-panel`, `.format-panel`, `.metric`, and `.panel-title` supply their own spacing.

`.metric-grid` uses four columns and an 18px desktop gap, becoming two columns up to 900px. Metric cards pair a concise label and icon with one prominent tabular value. Use the decorative top rules sparingly and retain explicit status labels where needed.

#### Buttons and controls

| Class               | Current specification                                   | Appropriate use            |
| ------------------- | ------------------------------------------------------- | -------------------------- |
| `.button.primary`   | Blue fill, white text, no shadow                        | Main action in a task area |
| `.button.secondary` | White fill, subtle border, dark text                    | Supporting action          |
| `.button.small`     | 12px text, minimum height 31px, padding 6px 10px        | Compact contextual action  |
| `.icon-button`      | Minimum 32px square, transparent background, hover tint | Named icon control         |

The base button is 13px, weight 600, radius 8px, minimum height 42px, and padding 10px 15px. Use links for navigation and buttons for actions. Set `type="button"` for non-submit buttons inside forms.

Disabled buttons use 0.5 opacity and a not-allowed cursor. In-progress actions use explicit text such as “Starting…” or “Queuing…” and disable duplicate submissions. There is no shared loading-button component.

Native selects have a 35px minimum height; the Records toolbar raises this to 40px. Search text is 13px. Keep labels explicit, even when the label is visually hidden.

#### Status and feedback

`Badge` from [components/common.tsx](components/common.tsx) takes a `value: string` and formats its visible name. Styled variants include `succeeded`, `completed`, `active`, `running`, `failed`, `interrupted`, `queued`, and `pending`. Dimension results have additional `.dim-*` styles. Unknown values receive neutral styling; explicitly design any new status rather than assuming it has a semantic colour.

`ErrorBox` takes `message: string`, renders nothing for an empty message, and otherwise renders an inline error with `role="alert"`. `.alert.warning` and `.alert.info` are CSS patterns used separately; they are not exported React components. Error-alert colours differ slightly from failure-badge colours in the current CSS.

Loading, empty, failed, unavailable, and zero are distinct states. For example, “No runs yet” should offer the next action; an API failure should provide an error and a useful recovery path. Do not turn a failed request into a reassuring empty state.

#### Tables and disclosure

Use a panel around a `.table-wrap`, semantic table markup, and column headings. The Runs wrapper is a focusable labelled region so keyboard users can reach the scrolling area. New wide tables should follow that pattern.

The Runs table prioritises run identity, status, progress, pass rate, requirement coverage, latency, and evaluation details. Search failures, interrupted requests, critical failures, and evaluation failures stay visible. Native `details` and `summary` disclose secondary metrics and regrading actions without making the whole row a click target.

Keep the same principle in related apps: expose the information needed to decide; disclose supporting diagnostics. An overdue ticket count belongs in the summary, while request headers belong in the detail view.

#### Dialogs

`Modal` from [components/common.tsx](components/common.tsx) accepts `title`, optional `subtitle`, `children`, and `onClose`. It uses a native `dialog`, calls `showModal()`, associates its title and description, focuses the close button, and restores previous focus on cleanup. Escape and clicks targeting the dialog backdrop request closure through `onClose`.

Desktop width is `min(1100px, 94vw)` and maximum height is 92vh. Mobile width is 97vw and maximum height 96vh. Structure content using `.modal-body` and `.modal-footer`; the body scrolls while the outer dialog remains contained. Busy-state closure policy belongs to the caller.

The benchmark setup currently uses a substantial review dialog. A dedicated multi-step setup page was discussed but has not been implemented.

### Artwork system

#### Collection and attribution

The collection is a URL catalogue of 155 public-domain Impressionist and Post-Impressionist works (`lib/artwork-catalog.json`, W-79), built from the Google Art Project scans on Wikimedia Commons by `scripts/build-art-catalog.mjs`. Only one image is stored locally, as the offline fallback.

[public/art/README.md](public/art/README.md) records the image sources, rights, and Google Arts & Culture references. Each entry stores a 1280px Wikimedia Commons thumbnail URL, its Google Arts & Culture page, its Commons file page and licence, and the holding museum. Browsers load the images from Wikimedia; the app never calls a Google API. Google Arts & Culture is a discovery and reference destination, not a live image feed. A new work needs its own verified reuse rights; its appearance on Google does not establish permission to copy it.

The caption displays artist, title, and year and opens the matching Google Arts & Culture reference in a new tab using `noopener noreferrer`. Its accessible name also announces the new tab. The painted region is a decorative CSS background rather than a content image with alt text. If a future app asks people to study the painting itself, use a proper image with meaningful alt text and access to the uncropped work.

#### Selection lifecycle

[lib/artwork.ts](lib/artwork.ts) owns the catalog and Fisher–Yates shuffle. [ArtworkHeader](components/artwork-header.tsx) owns browser lifecycle and image loading.

1. The initial server and client render show a neutral art area, without a random server-selected painting.
2. After mounting, a deferred effect selects the next work and preloads it with `Image`.
3. After a successful load, the image and matching caption appear together.
4. Each bag contains every catalogued work once. The next bag cannot start with the last work of the previous bag.
5. The remaining bag and last selection persist under `benchmark-artwork-shuffle-v2` in `sessionStorage`.
6. Mounting or a pathname change selects another work. A persisted `pageshow` event also selects another work after a back/forward cache return.
7. Polling re-renders and query-string filter changes do not themselves trigger selection. There is no timed rotation.
8. Cleanup removes listeners and pending image callbacks. Deferring selection avoids consuming an extra work during React Strict Mode's discarded initial effect.

With storage blocked, an in-memory bag still supports navigation, but no-repeat history cannot survive a full reload. New independent sessions have independent orders and can coincidentally start with the same work. Failed image loading (offline use, a blocked host or a removed Commons file) shows the local fallback, Monet's _Water Lilies_, with its own caption, so error fallback can repeat that painting.

#### Adding another painting

Add the artist to the list in `scripts/build-art-catalog.mjs`, or adjust its per-artist limit, then run `node scripts/build-art-catalog.mjs`. The script accepts only Google Art Project paintings in landscape format with a Google Arts & Culture asset ID and a public-domain or CC0 Commons licence, checks that each thumbnail and reference page responds, and fails below 100 works. Do not hand-edit `lib/artwork-catalog.json`. Bump `artworkStorageKey` so existing sessions start a fresh bag, inspect the desktop and shallow mobile crops of new works, and run the artwork tests. Only the offline fallback belongs in `public/art/`.

### Interaction and content rules

#### Brand standard

Use task-oriented labels such as “New benchmark”, “Choose CSV file”, and “Regrade saved answers”. State what will happen, distinguish a retry from a new operation, and describe errors in language that helps the person recover. Keep credentials, tokens, and backend details out of routine task instructions unless they are needed to configure the task.

Keep decoration stable while a person works. Loading benchmark data must not reshuffle artwork or move the main action. Avoid optimistic success messages before the action has completed.

#### Metric integrity in the current app

The implementation in [lib/schema.ts](lib/schema.ts) controls these definitions:

- Progress counts terminal search records, including failed and interrupted searches.
- Pass rate is passed divided by passed plus failed requirement decisions. Review and unassessable cases do not contribute to its denominator.
- Requirement coverage is successful requirement-evaluation records divided by all records. It is not interchangeable with the total number of graded answers.
- Average latency uses successful search requests, not queue wait or grading time.
- Incompatible evaluator policies suppress combined mean scores and pass rates.
- Null or unavailable values display an em dash. Zero remains zero.

Reuse the honesty of these patterns in another product, but define that product's metrics separately. For example, a “95% resolution rate” should have its eligible-case count or coverage alongside it, so excluded cases cannot disappear behind an impressive percentage.

`percent()` expects values already expressed on a 0–100 scale; it does not multiply a 0–1 fraction by 100. `latency()` expects milliseconds and formats seconds. `date()` uses the browser's locale through `toLocaleString()`.

### Current implementation map

| Source                                                         | Responsibility                                                               | Porting note                                                                                     |
| -------------------------------------------------------------- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| [app/layout.tsx](app/layout.tsx)                               | Metadata, global stylesheet, shared shell                                    | Set the new product's metadata and mount the shell once                                          |
| [app/globals.css](app/globals.css)                             | Tokens, global rules, components, responsive overrides                       | Read the full cascade; later polish rules override earlier declarations                          |
| [components/shell.tsx](components/shell.tsx)                   | Brand area, sidebar, topbar, footer, main landmark                           | Replace product-specific routes and labels; exact path matching currently sets active navigation |
| [components/page-heading.tsx](components/page-heading.tsx)     | Shared heading API and painted header composition                            | Reuse the prop contract                                                                          |
| [components/artwork-header.tsx](components/artwork-header.tsx) | Client selection lifecycle, preload, caption                                 | Depends on React and Next.js `usePathname`                                                       |
| [lib/artwork.ts](lib/artwork.ts)                               | Catalog typing, shuffle, storage validation and offline fallback             | Scope the storage key to the new app                                                             |
| [lib/artwork-catalog.json](lib/artwork-catalog.json)           | Generated URL catalogue of Google Art Project works                          | Regenerate rather than hand-edit                                                                 |
| [scripts/build-art-catalog.mjs](scripts/build-art-catalog.mjs) | Builds and verifies the catalogue from Wikimedia Commons                     | Adjust the artist list for a different collection                                                |
| [public/art](public/art)                                       | Offline fallback image and attribution                                       | Copy source documentation with the assets                                                        |
| [components/common.tsx](components/common.tsx)                 | Badge, Modal, ErrorBox, CopyButton, display helpers                          | Also re-exports a benchmark API client; review before copying wholesale                          |
| [components/upload.tsx](components/upload.tsx)                 | Upload, review, setup and recent runs                                        | Product workflow, not a generic brand component                                                  |
| [components/runs.tsx](components/runs.tsx)                     | Metrics, run summaries and disclosures                                       | Reference for analytical hierarchy                                                               |
| [components/records.tsx](components/records.tsx)               | Filters, response table and evidence details                                 | Reference for investigation workflows                                                            |
| [components/cms-access.tsx](components/cms-access.tsx)         | CMS connection and approval-request UI                                       | Product-specific access flow                                                                     |
| [app/cms/approve/page.tsx](app/cms/approve/page.tsx)           | Standalone supervisor approval route                                         | Shell intentionally omits workspace navigation on this route                                     |
| [tests/artwork.test.ts](tests/artwork.test.ts)                 | Shuffle cycles, persistence, storage failures, catalogue rights and fallback | Preserve tests when reusing the artwork system                                                   |

The current stack is Next.js 16.4.5 App Router, React 19.3.1, TypeScript, plain global CSS, and Lucide icons. The project uses pnpm and declares Node 24.x. There is no Tailwind or shared UI-framework dependency. Follow the installed Next.js documentation and project instructions when modifying framework behaviour.

### Adopting the brand in another app

1. Define the new app's primary task, navigation, and key decision metrics. Keep the brand, but write product-specific labels and explanations.
2. Establish the colour variables and typography above. Retain system fonts unless a shared brand decision changes them.
3. Extract the shell, header, panels, controls, status badges, dialog and table patterns. Preserve responsive and accessibility rules with each pattern.
4. Copy the artwork controller, catalogue, build script, fallback image and attribution together. Use an app-specific storage key; replace `usePathname` with that framework's route lifecycle if needed.
5. Replace the current shell's route map, path labels, workspace copy, metadata, and approval-route exception. Do not carry an unrelated CMS bypass into a different app.
6. Keep application APIs and scoring logic separate from reusable presentation components. Configure `@/` imports or replace them with the new app's paths.
7. Use semantic names such as `--color-action` in a future shared token package if useful, mapped to the exact values here. These names are proposed aliases, not variables already available in this app.
8. Validate real task flows, keyboard operation, mobile layouts, caption crops and metric definitions before release.

For a Next.js port, remember that `PageHeading` imports `ArtworkHeader`, which imports `lib/artwork.ts`. Copying only the visible header JSX will omit shuffling and attribution. Copying only the root colour variables will omit typography, layout and responsive behaviour.

#### Reusable implementation brief

> Build this app using the branding in the Benchmark UI Design and Implementation Handbook. Use ivory `#f7f5ef`, near-white panels `#fffefa`, ink `#263449`, supporting text `#626e79`, and primary blue `#355f87`. Pair Georgia page titles with system sans-serif controls. Use the shared sidebar and topbar structure, 14px panels, 16px painted page headers, restrained borders, and Lucide stroke icons. Keep data and forms on opaque surfaces. Curate a catalogue of at least 100 public-domain Google Art Project Impressionist works with source attribution and a local offline fallback, shuffling per visit rather than on a timer. Preserve labelled statuses, keyboard access, mobile layouts, and visible failure information. Adapt routes, labels and metrics to the new product. Use the handbook's acceptance checklist and document any deliberate departures.

### Acceptance checklist

#### Visual identity

- [ ] Core colour values match; decorative accents do not encode status.
- [ ] Page titles use the serif stack; controls and data use sans-serif.
- [ ] Each normal workspace page has one H1 and a clear task description.
- [ ] Art stays inside the header; tables and inputs remain readable and opaque.
- [ ] Every painting has a correct artist, title, year, source link and rights record.

#### Responsive behaviour

- [ ] Check 1440px, 1150px, 900px, 650px, 390px and 375px viewport widths, including just above and below the breakpoints.
- [ ] Sidebar widths and main offsets agree; icons retain accessible names on mobile.
- [ ] Page content has no unintended horizontal overflow; wide tables scroll internally.
- [ ] Long titles, action labels and captions wrap without covering controls.
- [ ] At 200% zoom, content remains operable and dialogs retain reachable actions.

#### Interaction and accessibility

- [ ] Keyboard users can reach navigation, actions, filters and table disclosures.
- [ ] The skip link targets the main landmark; focus indicators remain visible.
- [ ] Dialog title, focus placement, Escape behaviour and focus restoration work.
- [ ] Statuses and errors use text as well as colour; form fields have programmatic labels.
- [ ] Essential text meets contrast requirements, including new state combinations.
- [ ] Reduced-motion preferences are respected. Enlarge compact controls for touch-heavy use; current 31–32px controls are not a universal 44px target standard.
- [ ] Loading, empty, error, zero and unavailable states are tested separately.

#### Artwork and data behaviour

- [ ] Visits and refreshes advance the artwork; ordinary polling does not.
- [ ] Every painting appears once per bag, including after reloads; cycle boundaries do not immediately repeat under normal storage and successful loading.
- [ ] Back/forward navigation, storage denial, damaged stored state and image failure have sensible behaviour.
- [ ] A caption always matches the displayed image.
- [ ] Failures and incomplete coverage remain visible beside headline metrics.

For implementation changes in this repository, run `pnpm typecheck`, `pnpm lint`, `pnpm exec vitest run tests/artwork.test.ts`, and `pnpm build`, plus tests relevant to any changed behaviour. These commands do not replace browser review or a full accessibility audit. Documentation-only changes need source and link checks rather than a rebuild.

### Maintenance and known gaps

The current design is a working app style, not a fully extracted design system. Colours, spacing, radii and some control states remain hardcoded. Global selectors such as `main`, `h1`, `table` and `summary` can affect unrelated screens. Later polish rules and media queries override older definitions, so the first declaration of a class may not describe its final appearance.

Primary hover styling currently uses `:hover:enabled`, which applies to enabled buttons but does not provide the same hover rule for navigation links styled as buttons. New shared controls should cover both element types. Compact controls and small artwork or eyebrow labels need contextual review rather than automatic reuse for every audience.

The implemented scheme is light-only. There is no exported token package, Storybook catalog, theme switcher, timed gallery, live Google gallery API integration, or implemented multi-step benchmark wizard. Full browser visual regression coverage and a full accessibility audit are not established by the current build and unit checks.

When the brand evolves, update this handbook with the corresponding token, component, asset and test changes in the same revision. Prefer consolidating existing overrides over adding another layer. Record intentional departures in each related app so a local exception does not silently become a new family-wide convention.
