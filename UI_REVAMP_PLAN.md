# UI revamp work plan: garden study (Workbook v3.0)

**Status:** Implemented 2026-11-25 on branch `ui-garden-revamp` (D1–D5 taken as recommended). Open follow-ups: remove the rotating-art flag after one release; recheck 200% zoom in a real browser.
**Source of truth:** `UI_DESIGN_WORKBOOK.html` v3.0 ("Garden · Brabant · Clichy")
**Replaces:** the ivory/blue look described in `UI_HANDBOOK.md` (that theme stays in the handbook as Appendix A)

## 1. Goal

Re-skin the Doc Search Benchmark web app to the workbook's garden study without changing what any screen does. The ground is Brabant sage, work surfaces are opaque chalk, actions are garden violet, the ochre contour marks the bars, and a serif nameplate carries page identity. Decoration stays in the hero, the rules, the card heads and the footer. It never sits under tables, forms or figures.

Out of scope: new features, data model changes, dark mode (the workbook validates the light chalk surface only).

## 2. Where the app is today

| Area | Current state | Gap to workbook |
|---|---|---|
| Tokens | `app/globals.css` (2,386 lines) has 11 custom properties (`--blue`, `--bg`, …) and about 125 hard-coded hex values | Needs the full `--color-*`, `--d1…d4`, `--series-*`, `--seq*`, `--status-*`, radius, shadow, `--contour`, `--ticks` and `--weave` set |
| Cascade | Two sets of breakpoint blocks (lines ~1558–1677 and ~2233–2286), with later rules overriding earlier ones | Merge into one block per breakpoint before re-skinning |
| Shell | `components/shell.tsx` has a sidebar, a topbar and a footer | Add the contour rule under the topbar, violet active state, serif nameplate, red-earth footer, and a decided ≤650px behaviour |
| Page identity | `page-heading.tsx` and `artwork-header.tsx` rotate 155 Google Art Project works (`lib/artwork*`, `public/art`) | The workbook uses a **generated, seeded painted field** and treats paintings as references only (see decision D1) |
| Type | Georgia h1 at 38px, sans h2 | Iowan/Palatino serif stack: 46px title, 19px section, italic serif eyebrows and table heads, 38px tabular metrics |
| Badges | `Badge` in `components/common.tsx` uses the raw value as its class, so unknown statuses get no styling | Explicit status map; unknown values fall back to neutral; failure crimson is distinct from red earth |
| Metrics | `.metric-grid` in `runs.tsx`; `records.tsx` shows a metrics note | Positional bands (ochre, lavender, sage, red earth) that carry no status; denominator beside every percentage |
| Dialog | `Modal` already uses native `<dialog>` with `showModal()` | Re-skin as a chalk wall under an ochre contour; check width (`min(1100px, 94vw)`) and the busy-close policy |
| Tables | `records`, `runs`, `upload`, `comparison-results`, `dimension-evaluation` | Chalk surface, italic serif heads, focusable scroll region, diagnostics in a disclosure |
| Charts | None in the app today | Add the chart tokens only; build charts later against them |
| Testing | Vitest unit tests; no browser, visual or axe checks | Add a browser check for the acceptance list (Phase 6) |

## 3. Decisions to make before Phase 2

| # | Decision | Recommendation |
|---|---|---|
| D1 | **Header imagery.** Keep the rotating painting catalogue, or switch to the workbook's generated, seeded painted field? | Switch to the generated field. It matches the workbook, needs no image rights or attribution, never reshuffles while loading, and is static. Keep `lib/artwork*` behind a flag for one release, then remove it with `public/art` and `tests/artwork.test.ts`. If you keep rotation, the three "(If rotating)" checklist items apply instead. |
| D2 | Phone navigation at ≤650px: icon rail (~60px) or drawer? | Icon rail. The app has three nav items, and the current CSS already collapses toward a rail. |
| D3 | Painted footer strip (red-earth canvas, 90px)? | Yes, but thin (~48px) in the app so it doesn't compete with work surfaces. |
| D4 | Hero height. The workbook hero is ≥460px, which is too tall for a working page. | Painted band ~180–220px behind a chalk plaque that holds eyebrow, H1, description and action. Smaller still on Runs and Records, which are table-led. |
| D5 | Standalone `/cms/approve` page (emailed to supervisors) | Same tokens and plaque, no shell and no canvas, so it stays light. |

Record the chosen answers in the workbook's §2 "Product definition" worksheet as deliberate departures.

## 4. Phases

### Phase 0: Prep (½ day)
- Commit `UI_DESIGN_WORKBOOK.html`. It is currently untracked.
- Fix the workbook's loose ends:
  - The §4 mono sample still shows the old blue `--color-action: #2c486c`.
  - The triptych images point at `impressionst_ref/previews/`, which doesn't exist in the repo.
- Take baseline screenshots of `/`, `/runs`, `/records` and `/cms/approve` at 1440, 900 and 390px so changes can be compared.
- Settle D1–D5.

### Phase 1: Token foundation (1 day)
- Use the workbook's "Copy token CSS" output as the new `:root` block in `globals.css`.
- Alias the old names to the new tokens (`--blue` → `--color-action`, `--bg` → `--color-bg`, `--surface` → `--color-surface`, …) so nothing breaks mid-migration. Delete the aliases at the end of Phase 3.
- Replace the ~125 hard-coded hex values with tokens. Any colour without a matching token gets a named token or is removed. No raw hex outside `:root`.
- Merge the duplicate breakpoint blocks into one block each at ≥1500, ≤1150, ≤900 and ≤650.
- Set focus globally: 3px violet outline, offset, with an ochre halo. The halo is never the only indicator.
- **Done when:** the app looks roughly the same but is fully tokenised, and `pnpm lint`, `pnpm typecheck` and `pnpm test` pass.

### Phase 2: Shell and page identity (1½–2 days)
- `shell.tsx`
  - Sage ground with weave.
  - Sidebar ~220px (~206px at ≤1150px).
  - Active nav uses `--color-active-bg` and violet.
  - Ochre contour under the ~65px topbar.
  - Icon rail with `aria-label`s at ≤650px (D2).
  - Painted footer (D3).
  - Keep the skip link and `main#main-content`.
- New `components/painted-field.tsx`
  - Port the workbook painter (`rng`, `stroke`, `paintField`) to a client component.
  - It is `aria-hidden`, seeded per route so it paints the same on every visit, and never animates.
  - Repaint only on resize (debounced).
  - Render a flat `#9aa58e` fallback during SSR so loading never shifts layout.
- `page-heading.tsx`: chalk plaque over the field (D4), contour on the plaque, Clichy ticks before the italic serif eyebrow, 46px serif H1, one primary action.
- Remove `ArtworkHeader` from the heading (D1).
- **Done when:** all four routes render the new shell and heading at every breakpoint with no horizontal overflow at 375/390px.

### Phase 3: Component re-skin (2–3 days)
Work through shared pieces first, then each screen.
- **Buttons:**
  - Primary is violet with an ochre lip. Secondary is chalk with a sage-grey border. Also small and icon variants.
  - Uneven radii come from `--radius-button`.
  - Hover rules cover both `button` and `a.button`, which fixes the handbook's known gap with `:hover:enabled`.
  - In-progress buttons show explicit text ("Starting…") and block a second submit.
- **Badges:**
  - Explicit map in `Badge`: succeeded/completed → success, active/running → active, failed/interrupted → danger, queued/pending → warning, anything else → neutral.
  - The `dim-pass` / `dim-fail` variants reuse the same tokens.
- **Forms:**
  - Sage-grey input border (~3.8:1), never ochre.
  - Programmatic labels and hints throughout `upload.tsx`, `prompt-editor.tsx`, `dimension-editor.tsx`, `criteria-editor.tsx`, `model-selection.tsx` and `cms-login-form.tsx`.
- **Alerts:** use `ErrorBox` and a new info/warning variant with the workbook pattern: a bold lead sentence, then the action.
- **Metric cards:**
  - Positional bands in `runs.tsx` with the 38px serif tabular figure.
  - The supporting line carries the denominator ("120 of 150 eligible").
- **Tables:**
  - Chalk surface, italic serif heads, `tabindex="0"` scroll region with a label, row disclosure for diagnostics.
  - No brushwork. The row is not a click target.
- **Dialog:** chalk with an ochre contour head. Check focus placement, Escape, backdrop close and focus restore, and that mobile is 97vw / 96vh.
- **Screens:** `upload.tsx` (877 lines) and `records.tsx` (956 lines) are the largest, so plan one sitting each. Then `runs`, `comparison-results`, `dimension-evaluation`, `requirement-evaluation`, `cms-access`, `cms-approval`, `prompt-section-editor` and `trace-link`.
- **Done when:** no aliases are left, and every component matches §6 of the workbook.

### Phase 4: States and data honesty (1 day)
- Audit each data view for the five states: loading, empty, failed, unavailable, zero.
  - A failed fetch must never render as "No runs yet".
  - `null` renders as "—" with a reason. `0` renders as `0`.
  - The `percent()` and `latency()` helpers already return "—" for null. Check callers don't coerce null to 0.
- Put a denominator beside every percentage in `runs.tsx`, `records.tsx` and `comparison-results.tsx`. Show exclusions and unassessable counts next to the figure, never only in a tooltip.
- Show failures and partial coverage next to headline metrics.

### Phase 5: Chart readiness (½ day, optional now)
- Ship `--series-1…8`, `--seq*`, `--seq2*`, `--div-mid`, `--status-*` and `--chart-*` in Phase 1. They are already in the token block.
- Add a short `lib/chart-tokens.ts` that lists series in fixed order, with a ninth series folding into "Other" and slots 1–3 only for scatter. Build no charts until a screen needs one.

### Phase 6: Verification (1–1½ days)
- Add Playwright with `@axe-core/playwright` as dev dependencies, plus one spec per route that:
  - checks horizontal overflow at 1440, 1150, 900, 650, 390 and 375px
  - checks keyboard order, the skip link and the dialog focus cycle
  - runs axe with no serious or critical violations.
- Manually check 200% zoom and long-title wrapping, and confirm `prefers-reduced-motion` causes no motion.
- Compare screenshots against the Phase 0 baseline.
- Work through the workbook §12 acceptance checklist and tick it in the browser.
- Run `pnpm build` and `pnpm deploy:check`.

### Phase 7: Docs and cleanup (½ day)
- Update `UI_HANDBOOK.md`:
  - The garden study becomes the brand standard, with ivory/blue kept as Appendix A.
  - Refresh the colour, type, layout, component and artwork sections and the implementation map.
  - Rewrite the "Maintenance and known gaps" section.
- If D1 goes to the generated field, remove the artwork catalogue code, `public/art`, `scripts/build-art-catalog.mjs` and the related tests in a separate commit.
- Fill in the workbook's §2 Product definition worksheet.

## 5. Timeline

About **8–11 working days** for one developer.

| Phase | Effort | Can ship alone? |
|---|---|---|
| 0 Prep | 0.5d | n/a |
| 1 Tokens | 1d | Yes, visually close to today |
| 2 Shell and identity | 1.5–2d | Yes |
| 3 Components | 2–3d | Ship as a batch, with aliases removed at the end |
| 4 States | 1d | Yes |
| 5 Charts | 0.5d | Yes |
| 6 Verification | 1–1.5d | n/a |
| 7 Docs | 0.5d | n/a |

Suggested commits: one per phase, and one per large screen inside Phase 3.

## 6. Risks

- **Cascade surprises.** Global selectors (`main`, `h1`, `table`, `summary`) and late overrides can hide changes. Merging the breakpoints in Phase 1 reduces this, and the Phase 0 screenshots catch the rest.
- **Ochre misuse.** Ochre on chalk is about 2:1, so it must only ever be a line. A lint grep for `--d1` or `#d1a93a` on any `color:` property guards this.
- **Red earth versus failure.** Red earth (`--d4`) and danger crimson (`--color-danger`) are close in hue. Failure always carries the word "Failed", and red earth never appears next to a status.
- **Canvas cost.** The painter runs on every route change. Cache it per route and size, and keep it off `/cms/approve`.
- **Next.js 16.4.** Read `node_modules/next/dist/docs/` before touching `layout.tsx` or client boundaries (see `AGENTS.md`).
