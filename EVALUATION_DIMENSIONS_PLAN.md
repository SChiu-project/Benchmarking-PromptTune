# Work plan: CMS-style evaluation dimensions with configurable selection

Date: 2026-11-22. Status: P0–P4 implemented and verified locally, including live agreement validation against the CMS export (dimensions and pairwise preference). Human calibration remains the release-gating prerequisite.
Input evidence: CMS benchmark export `result_ea77cd43-5b83-49eb-95e6-7fc662ec3167.xlsx` (100 cases × 2 models, Results + Summary sheets). Current implementation: `EVALUATION_GUIDE.md`, `EVALUATION_IMPROVEMENT_PLAN.md`, `lib/evaluator.ts`, `lib/evaluation-contract.ts`, `lib/requirement-scoring.ts`, `lib/schema.ts`, `lib/doc-search.ts`.

## 1. What the CMS export actually measures

Per answer, per model, six dimensions. Each has `passed` (PASS/FAIL), `reason`, and a numeric field (`confidence` 0–1, except context_relevance which has `average_score`):

| CMS dimension | What the judge checks (from reasons in the export) | Extra output | Required inputs |
| --- | --- | --- | --- |
| `context_relevance` | Per-passage relevance of retrieved passages to the query; reports `Avg: 1.45, Relevant: 14/31` | average_score, relevant/total counts | query + retrieved passages |
| `temporal_accuracy` | Tense/time consistency of the answer relative to the evaluation date; dated events correct | confidence | answer + evaluation date |
| `completeness` | Answer fully addresses what the question asked (no reference answer used) | confidence | question + answer |
| `no_answer_detection` | Meaningful direct answer vs evasive/unnecessary clarification; must state lack of info if it cannot answer | confidence | question + answer (+ answer source node) |
| `hallucination_detection` | All factual claims supported by the provided passages; no fabricated claims | confidence | answer + passages |
| `citation_quality` | Facts attributed to the correct passage markers ([1]/[P#]); citations exist when passages exist | confidence | answer + passages + citation markers |

Aggregation in the export:

- `eval_pass_rate` = passed dimensions / total dimensions (83.3% = 5/6, 66.7% = 4/6).
- `eval_overall_passed` = PASS only when **all** dimensions pass (Summary "Overall" = 42% / 39%).
- Summary sheet: per-dimension Total/Passed/Failed/Pass Rate per model, plus Overall.
- `eval_preferred_model` + reasoning: blind pairwise A/B preference per case (win/tie/unknown), summarized as win rates.
- Non-eval columns: Answer Source (`tool_early_return` / `answering_node`), Used Sections (citation URL list), Follow-Up Questions, Matched Catalogue, Langsmith Trace ID, Runtime Trace Tags, per-stage timings.

Important observed behaviors to decide about, not copy blindly:

1. **N/A counted as PASS.** "No passages to evaluate" → PASS with score 0.00 for context_relevance/citation_quality/hallucination. This inflates pass rates on `tool_early_return` cases (the export's own 66.7% rows are mostly this). Our improvement plan explicitly warns about N/A inflation (§Why the standard needs to change, item 5).
2. **Judge failures are per-dimension.** One cell shows `Evaluation failed: Upstream request timed out` while other dimensions still scored — dimensions are evaluated independently.
3. **No approved reference.** CMS completeness/no_answer judge against the *question*, not an approved expected answer. This is a different contract from our requirements-v2 track.
4. **Criteria definitions are not in the export.** The xlsx contains results only, and the CMS judge prompts are not available. Default prompts have therefore been drafted from industry-standard evaluation workflows (TruLens RAG Triad, Ragas Faithfulness/Context Precision/Aspect Critic, DeepEval G-Eval) — see [EVALUATION_DIMENSION_PROMPTS.md](EVALUATION_DIMENSION_PROMPTS.md) — and must be validated against these 100 labeled cases. Exact CMS thresholds (e.g. what average_score passes context_relevance) remain unknown and are configurable parameters.

## 2. Gap analysis vs the current tool

| CMS capability | Current tool | Gap |
| --- | --- | --- |
| Six named dimensions with pass/fail + reason + confidence | Legacy holistic 4 scores (correctness/coverage/relevance/compliance, 0–100 weighted); requirements-v2 checklist | New dimension suite needed; do not reuse or blend the legacy weighted score |
| Hallucination / grounding vs passages | requirements-v2 `grounding` + `unsupported_claims` with mechanical quote validation | Mostly exists; repackage as a standalone dimension that works without approved criteria |
| Citation attribution correctness | Quote provenance validation only | New: check each [n]/[P#] marker maps to a passage that supports the claim |
| Passage relevance scoring | None (passages captured in `SearchResult.sources` but never relevance-scored) | New dimension; inputs already available |
| Temporal accuracy | None | New dimension; needs evaluation date frozen in campaign |
| No-answer / evasion detection | None (`answering_failed` only detects hard failures) | New dimension; `tool_early_return` answers currently score as normal answers |
| Configurable dimension set | Fixed: criteria present → requirements-v2, else legacy | New: per-run dimension selection, frozen in campaign snapshot |
| Per-dimension pass-rate summary | Run summary has pass/fail/review counts, not per-dimension rates | Extend summary + records UI |
| Pairwise model preference | Post-hoc paired run comparison (`evaluation-report.ts compare`), no per-case blind preference judge | New phase; requires two answers per case in one judgment |
| CMS-compatible export | JSON/CSV records | New export mapping to `eval_*` columns + Summary sheet |
| Per-stage timings, trace tags, answer source node | End-to-end `latencyMs` + `traceId` only; `rawResponse` retained | Capture answer-source/node fields if the docSearchConvo response exposes them; Langsmith stage timings are a separate trace-fetch dependency — defer |

## 3. Design decisions (proposed)

### 3.1 Parallel track, not a replacement

Add a **dimension suite** rubric (`dimensions-v1.0`) alongside requirements-v2 and legacy:

- Requirements-v2 stays the reference-fulfillment track for approved-criteria runs (release gating).
- The dimension suite is the CMS-comparable track: question-based, works without approved criteria, produces per-dimension PASS/FAIL/N/A + reason + confidence.
- A run may enable the dimension suite, requirements-v2, or both; results are stored and displayed separately. Never combine a dimension pass rate with a fulfillment percentage into one number.
- Legacy holistic scoring remains read-only for historical records.

### 3.2 Dimension registry (the configurability mechanism)

One server-side registry entry per dimension:

```ts
{
  name: "context_relevance" | "temporal_accuracy" | "completeness"
      | "no_answer_detection" | "hallucination_detection" | "citation_quality",
  defaultPromptBody, defaultVersion,          // drafted defaults, see EVALUATION_DIMENSION_PROMPTS.md
  promptBody, promptHash,                     // per-run value (default or user-edited), frozen per campaign
  outputSchema,                             // Zod: verdict/reason/confidence or per-passage/per-claim rows
  requiredInputs: ["passages"] | ["question","answer"] | ["evaluationDate"] ...,
  passRule,                                 // code-side, e.g. average_score >= threshold; thresholds editable per run
  naPolicy,                                 // see 3.4
  unavailableBehavior: "na" | "fail" | "skip"  // when required inputs missing
}
```

The prompt is split into a **code-owned fixed wrapper** (role, untrusted-data guard, JSON output contract) and a **user-editable criteria/steps body**. Users can edit the body and pass-rule thresholds before each run; the wrapper and schema are never editable, so quote validation and injection resistance survive any edit. Full draft prompts and the editing contract: [EVALUATION_DIMENSION_PROMPTS.md](EVALUATION_DIMENSION_PROMPTS.md).

- **Selection is per run**, chosen in the review dialog (checkboxes, default = all six), validated server-side against the registry. Unknown names rejected.
- The selection + each selected dimension's prompt/hash/threshold is snapshotted into the campaign (`evaluation-contract.ts` `campaignSchema`, additive optional field). Workers read only the snapshot — same discipline as the CMS prompt snapshots; no per-question config reads.
- Overall decision is computed **only over selected dimensions**: `overall_passed = every selected dimension PASS`; `pass_rate = passed / decided` (denominator policy in 3.4). Changing the selection later requires a new campaign/regrade, never a reinterpretation of old results.
- Adding a new dimension later = one registry entry + prompt + schema + tests; no engine changes.

### 3.3 One judge call per dimension

Match CMS's independent per-dimension evaluation:

- Each selected dimension gets its own evaluator call with its own system prompt and strict JSON schema; bounded concurrency (e.g. 3), per-dimension timeout/retry, per-dimension attempt records (model, tokens, timing) in the existing attempt history.
- One dimension failing/timing out marks that dimension `error` — it must not erase the other dimensions' results, and must not silently count as PASS.
- Cost note: 6 calls/case vs 1. Make the selection the cost control (user picks 2–3 dimensions for cheap runs). Record token usage per dimension for measured cost estimates.
- All embedded text (question, answer, passages) stays UNTRUSTED DATA with the existing injection guard wording; reuse the quote/evidence validation approach where a dimension cites passages.

### 3.4 N/A and failure semantics — explicit decision point

Two policies, configurable per run but frozen in the campaign:

- **strict (recommended default):** missing required inputs (e.g. no passages) → `not_applicable`, excluded from the pass_rate denominator and shown as a separate count; overall PASS requires all *applicable* selected dimensions to pass, with at least one applicable. This fixes the inflation visible in the CMS export.
- **cms-compatible:** N/A → PASS with score 0, exactly like the export, for apples-to-apples comparison with CMS numbers.

Reports must always show which policy produced the numbers; never compare pass rates across policies without labeling.

### 3.5 Inputs already available / to capture

- Passages: `SearchResult.sources` from `used_sections` (already persisted, already used by regrade).
- Evaluation date: freeze `evaluatedAt` date in the campaign for temporal_accuracy.
- Answer source node (`tool_early_return` vs `answering_node`): inspect retained `rawResponse` fixtures from a live dev call; if present, capture as an optional additive field and feed no_answer_detection. If absent, the dimension judges from text alone and the export column stays empty — do not invent it.
- Follow-Up Questions / Matched Catalogue / stage timings: only if the response or a verified trace source exposes them; otherwise out of scope for v1 (trace fetch is a separate authenticated dependency, like the CMS prompt work).

### 3.6 Pairwise preference (later phase)

`eval_preferred_model` needs two answers per case judged blind (A/B randomized, variant identity hidden). Fit: a paired-comparison mode that takes two completed runs on the same frozen case set (baseline/candidate prompt or model) and adds a preference judgment per case, stored as its own attempt type. Reuse the pairing/exclusion rules already in `evaluation-report.ts compare`. Win/tie/unknown summary mirrors the CMS Summary sheet. Not required for the six-dimension release.

### 3.7 Prompt review before every run (product requirement)

Before each benchmark generation the review dialog shows the default prompt of every selected dimension and lets the user edit it for that run: editable criteria/steps body + thresholds, required-placeholder validation, modified badge, diff against default, reset-to-default. The fixed safety wrapper and JSON contract stay code-owned. The final prompt text + hash + thresholds + N/A policy are snapshotted into the campaign; workers read only the snapshot; regrade reuses it and edited regrades create a new campaign. Runs with edited prompts are labeled, and comparison reports exclude pairs with differing dimension prompt hashes. Full contract: [EVALUATION_DIMENSION_PROMPTS.md](EVALUATION_DIMENSION_PROMPTS.md) §"Per-run prompt review and editing". This follows the same snapshot discipline as the existing requirements-v2 judge prompt and the CMS prompt baselines.

## 4. Development phases and acceptance gates

### P0 — Contract and fixtures (implemented 2026-11-22)

- Default prompts drafted from TruLens/Ragas/DeepEval workflows: [EVALUATION_DIMENSION_PROMPTS.md](EVALUATION_DIMENSION_PROMPTS.md). CMS's own prompts were unavailable; agreement-with-CMS is the validation target.
- `tests/fixtures/cms-export-labels.json`: all 100 export cases × 2 models — questions, answers, answer-source nodes, trace IDs, timings, used-section URLs, and CMS per-dimension labels (102 CMS-side judge errors flagged and excluded from agreement). **The export contains no passage content**, so context_relevance/hallucination_detection/citation_quality cannot be re-judged from it and are N/A; the fixture validates the three text-only dimensions.
- `lib/cms-fixture.ts` + `pnpm cms:import <fixture> [--grade] [--limit N]` import saved-answer runs (no Doc Search calls) with frozen dimension campaigns; `scripts/regrade-run.ts` regrades through the normal engine path.
- N/A default remains strict; context_relevance threshold default 1.0 — both per-run editable, still to be confirmed with the domain owner.

### P1 — Dimension engine and persistence (implemented 2026-11-22)

- `lib/dimension-contract.ts` (client-safe): registry with drafted default prompt bodies, per-dimension output schemas, code-side pass rules, quote validation, N/A rows, aggregation. `lib/evaluation-dimensions.ts` (server-only): prompt hashing, campaign resolution, bounded-concurrency dispatch with one transport retry and per-dimension attempts.
- `lib/evaluator.ts` paths untouched; `lib/engine.ts` and `lib/cloud-jobs.ts` grade the dimension suite as an independent second track (a requirements-track failure does not erase dimension results, and vice versa).
- `lib/evaluation-contract.ts` / `lib/schema.ts` / `lib/store.ts` / `lib/postgres-store.ts`: additive optional campaign `dimensions` field and per-record/attempt `dimensionSuite`; old state readable without migration. `createRun` accepts a `dimensions` selection, hashes it into submission identity, and freezes prompts/thresholds/N-A policy into the campaign; regrade and single-record retry reuse the frozen dimension campaign without new search calls.
- Verified: `pnpm typecheck`, `pnpm lint`, `pnpm test` (129 tests incl. 20 new in `tests/dimensions.test.ts`), `pnpm build`, `pnpm test:workflow` (local JSON + PostgreSQL). Covered: selection/prompt-edit validation, wrapper immutability, per-dimension pass rules, N/A vs error vs FAIL, verdict/row consistency, fabricated-quote rejection, per-dimension failure isolation and retry, concurrency bound, frozen campaign settings over live env, endpoint-change rejection, identity conflicts, regrade reuse, legacy compatibility, PostgreSQL JSONB parity and workspace isolation.
- Later phases completed after this note: P0 fixture import, P2 review-dialog prompt editor, and calibration tooling (see P0, P2, P4).

### P2 — Configurable UI and reporting (implemented 2026-11-22)

- Review dialog: `components/dimension-editor.tsx` — dimension checkboxes (default all six), required-input warnings, N/A policy choice (strict / cms-compatible), cost hint (judge calls per question), evaluator-not-configured warning. Each selected dimension exposes its default judge prompt for review/editing with placeholder/length validation, threshold inputs, Modified badge, line diff against default, and reset-to-default. The safety wrapper and JSON contract remain code-owned. Invalid edits block submission.
- `upload.tsx` sends the selection as `dimensions`; upload/project changes reset it and rotate the submission key (same discipline as the prompt/criteria editors).
- Reporting: `summarize()` adds per-dimension Total/Pass/Fail/Review/N/A/Error/Pass-rate plus an Overall row (CMS Summary-sheet shape); mixed prompt hashes/policies across regrades suppress rates but keep counts. `components/dimension-evaluation.tsx` renders the run-level table (records page), per-record PASS/FAIL + pass rate in the list, and full evidence (ratings, claims, citations, items, issues) in record details. Results are labeled "draft rubric, uncalibrated" with the N/A policy and judgment time.
- Regrade: the Runs page regrade dialog reuses frozen settings by default, or accepts a new dimension selection/edited prompts via the same editor; `regradeRun`/`POST /api/runs/<id>/evaluate` resolve it into a new campaign. Single-record retry reuses the frozen campaign and is now enabled for dimension-only records.
- Verified: typecheck, lint, 131 tests (summary stats, mixed suppression, regrade with new selection added), build, workflow smokes in both storage modes. Old runs display unchanged; queued work is bound to its frozen campaign.

### P3 — CMS-compatible export and comparison (implemented and validated 2026-11-22)

- `pnpm cms:export <runId> [runId2] <outDir>` writes `results.csv` + `summary.csv` in the CMS column layout (`eval_<dim>_passed/reason/confidence|average_score`, `eval_overall_passed`, `eval_pass_rate`, per-model suffixes, Summary metric rows), with rubric version and N/A policy labeled per run. Strict-policy summary totals count decided cases only.
- `evaluation-report.ts compare` now includes a paired per-dimension section (improvements/regressions/unchanged per dimension and overall); pairs with differing dimension prompt hashes/thresholds/policies are excluded with a reason.
- `evaluation-report.ts cms-agreement <runId> <fixture.json> <model> [out.json]` reports per-dimension agreement with CMS labels, confusion counts, Wilson intervals, and categorized exclusions (cmsError / ourError / ourReview / notApplicable) and disagreements (clarification_policy_difference vs semantic_disagreement).
- **Live validation (600 judge calls, qwen3.8-flash via the configured proxy):** both 100-case runs graded with 0 record failures. Agreement with CMS labels: temporal_accuracy 100% (95/95, 91/91), completeness 96.8% / 97.7%, no_answer_detection 73.1% / 67.8%; overall 90.1% / 88.4%. Nearly all no_answer disagreements are the documented clarification policy (our draft passes justified clarifications; CMS fails them) — a per-run editable policy choice, not a judge defect. Judge-side errors were ~1–2% (4 schema failures, 2 fabricated quotes correctly rejected) and isolated as errors, never passes. Evidence: `reports/cms-agreement-flash-0731.json`, `reports/cms-agreement-flash-1017.json`, `reports/comparison.json`, `reports/cms-export/`.
- Two integration bugs found and fixed by the pilot: the judge-response envelope now tolerates proxy-added top-level fields (passthrough, matching the existing evaluator), and report output-arg positioning after adding the cms-agreement command.
- Remaining (operational): passage-dependent dimensions need passage content from CMS or live retrieval before they can be validated against CMS labels. Human adjudicated labels are still required before release gating (calibration tooling is implemented; see P4).

### P4 — Pairwise preference + calibration support (implemented 2026-11-22)

- `lib/preference-contract.ts` + `lib/preference.ts`: blind pairwise preference (`preference-v1.0`, draft). A/B order randomized per case (position-bias mitigation); variant identity never reaches the judge; the stored `swapped` flag decodes verdicts. Identical answers auto-tie without a judge call (matches CMS behavior). Per-case errors isolated; win/tie/unknown summary mirrors the CMS Summary sheet (denominator = all cases).
- `pnpm preference:compare <baselineRunId> <candidateRunId> [out.json]` runs the comparison with the configured evaluator, persists it in a bounded history (20, oldest evicted) via `savePreferenceComparison`, and prints the summary. Pairing rules match `compare`: completed runs, same project, same complete unique case set.
- Calibration support: `calibrationTemplate`/`calibrationReport` now accept optional per-dimension labels (pass/fail/review/not_applicable; unknown = unlabeled), work for criteria-free runs (caseId falls back to record ID), compute per-dimension agreement, and apply the ≥90% pilot target per track. `stabilityReport` checks the last three identical-configuration dimension attempts for row disagreement alongside requirement stability.
- **Live validation (67 judge calls on the two 100-case CMS runs):** 26% baseline wins / 31% candidate / 41% ties / 2% unknown-error (CMS: 36.7 / 25.5 / 33.7 / 4.1). Agreement with CMS preference labels: **76.1% (70/92)**; all 33 identical-answer auto-ties match CMS ties exactly. Disagreements: 14 winner flips and 8 tie-vs-winner calls — both judges are LLMs, so this is judge-vs-judge variance, not ground truth. Evidence: `reports/preference-comparison.json`, `reports/preference-agreement.json`.
- Remaining (operational, not software): adjudicated human labels for dimensions and preference; passage content to validate the three passage dimensions; domain confirmation of the no_answer clarification policy and context_relevance threshold. No release gating on uncalibrated rubrics — all results stay labeled `uncalibrated_draft`.

## 5. Out of scope for this plan

- Langsmith trace fetching for per-stage timings/runtime tags (separate authenticated dependency; trace ID alone proves nothing — same lesson as the CMS prompt work).
- Replacing requirements-v2 or blending its fulfillment % with dimension pass rates.
- Any CMS writes; the suite only reads Doc Search responses and the configured evaluator.
- Automatic model switching: the tool benchmarks one generation config per run; two-model comparison stays a paired-run exercise.

## 6. Open questions for the user / CMS team

Resolved in the first software release; remaining items are domain confirmation, not blockers for using the tool.

1. ~~Can we get the actual CMS evaluator prompts?~~ Not available. Defaults are in [EVALUATION_DIMENSION_PROMPTS.md](EVALUATION_DIMENSION_PROMPTS.md) and were checked against the CMS export's labels. Still useful if CMS can share the context_relevance scale/threshold and confidence semantics.
2. ~~Default N/A policy?~~ Shipped as **strict** (N/A excluded from pass rate). Per-run choice includes cms-compatible.
3. ~~Pairwise preference in the first release?~~ Shipped as `pnpm preference:compare` (CLI). Not shown on the Runs page yet.
4. ~~Dimension suite on every benchmark?~~ **Opt-in** in the review dialog (cost: up to 6 judge calls per case).
