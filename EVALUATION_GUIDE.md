# Requirement evaluation v2

The benchmark now measures fulfillment against a checklist approved before the answer is graded. The default passing threshold is a provisional **85%** in the example criteria; it is editable and not a validated business standard. Human calibration remains required before using these decisions as release gates.

## Run a benchmark

1. Upload the normal question CSV. Existing CSV columns are unchanged.
2. In the review dialog, enable **Import or edit approved evaluation requirements**. Load a criteria JSON sidecar or edit the generated starter. Replace the starter with atomic requirements, and check its project ID, language, reference version, weights and critical flags.
3. Each requirement cites an exact substring of `expected_answer` or `evaluation_comments`. Applicability and its reason are frozen before grading. Set `partial` to null unless an explicit partial-credit rule is approved.
4. Enter the reviewer's name and approve. Edits, a new upload or a changed project invalidate this submission's approval. Download the approved criteria to reuse them. The identity is a reviewer attestation, not authentication of an independent reviewer.
5. Start the batch. Missing criteria cause grading to be skipped; answers are still saved. Semantic checks and additional-claim checks need the configured evaluator. Fully deterministic criteria with additional-claim checking disabled run without an evaluator or network request.

The [synthetic CSV](public/requirements-example.csv) and [draft criteria](public/requirements-example.json) demonstrate the accessibility case. They contain invented directions. The JSON intentionally has an empty reviewer name, so it must be reviewed and approved before submission. Change its project ID to the intended project. An LLM can draft candidate requirements outside this workflow, but generated requirements must not be treated as automatically approved.

## Scoring and decisions

For applicable requirements, code calculates `100 × sum(weight × credit) / sum(weight)`. Met earns 1; unmet earns 0; partial earns the approved fraction. Unknown retains its weight and produces a lower/upper range. N/A excludes only requirements marked inapplicable in the approved contract. With no applicable requirements, fulfillment is unassessable.

A definitive critical shortfall or blocking claim fails independently of the percentage. A definitively insufficient upper bound also fails. Otherwise unresolved requirement/claim evidence produces review. A complete answer at or above its threshold passes only when no critical or blocking issue exists. Decisions use the unrounded arithmetic; displayed percentages are rounded to one decimal.

The LLM cannot set credits, weights, applicability, scores or final decisions. It assesses semantic requirements and material additional claims. Code rejects duplicate/missing/foreign requirement IDs, unauthorized partial credit, fabricated answer/reference/passage quotes, invalid source indices, met semantic judgments without evidence, and asserted grounding without source evidence. Corrections shown to users come from the approved requirements rather than new model-generated advice.

Quote validation establishes provenance, not semantic truth. A real quote can still be misinterpreted. Each result explicitly records that semantic support is judge-assessed and not human-verified. Incomplete references should result in unknown or an annotation correction; lack of reference support alone does not establish falsehood.

Reference fulfillment and retrieval grounding are separate. Missing passages make grounding unknown. A trace ID remains available for investigation; this implementation does not fetch or assert the contents of traces it cannot inspect.

## Deterministic check methods

All checks still need an approved requirement/reference. Deterministic checks have no partial credit.

- `contains`: `{ "type": "contains", "value": "required literal", "caseSensitive": true }`. This checks literal presence only; negation and semantic correctness need semantic criteria.
- `max_length`: `{ "type": "max_length", "characters": 200 }`. Counts Unicode code points, not bytes or user-perceived grapheme clusters.
- `json`: `{ "type": "json" }`. Parses the complete answer as JSON; code fences fail.
- `numeric_json`: `{ "type": "numeric_json", "path": ["amount"], "expected": 10, "absoluteTolerance": 0.1, "relativeTolerance": 0, "unitPath": ["unit"], "unit": "HKD" }`. Requires a numeric JSON value and exact unit. Accepts an inclusive tolerance of `max(absoluteTolerance, abs(expected) × relativeTolerance)`. There is no implicit string coercion, unit conversion or rounding rule. Zero tolerance means exact numeric equality.

## Regrade without rerunning Doc Search

Use **Regrade saved answers** on the Runs page, or the regrade action in a record's details. Existing criteria are reused; the record editor can approve replacement criteria. Each regrade creates a new campaign, preserves old attempt results and their original question/criteria snapshots, and grades the saved answer and passages. It never sends a new search request. Only one run may be active.

For batch criteria replacement, POST `{ "criteria": <complete sidecar> }` to `/api/runs/<run-id>/evaluate`. POST `{}` to reuse existing requirements. Single-record regrading accepts `{ "criteria": <one criteria object> }` at `/api/records/<record-id>/evaluate`. The same origin/workspace authentication protections apply as to other benchmark APIs.

Campaigns snapshot dataset, reference and scoring-contract hashes; full judge prompt and its hash; configured model/endpoint/temperature/timeout; rubric and code version. Attempts additionally retain the evidence-bundle hash, original question/criteria, provider-reported model revision and token usage when the provider returns it. Credentials are never stored in campaigns. A changed endpoint requires a new campaign, preventing a credential from being sent to the prior endpoint after configuration changes. Code version uses the deployment commit when available, otherwise the explicit local rubric release identifier; local uncommitted edits are not independently fingerprinted.

Existing JSON and PostgreSQL snapshots use additive optional fields; no destructive migration is required. Historical results are labeled **Legacy holistic score**. Pre-v2 pending runs can finish their legacy evaluation; new runs cannot silently fall back to it. Legacy helper functions remain for backward-compatible consumers.

Run summaries show pass/fail/review, critical failures, unassessable cases, evaluation coverage over all intended cases, operational success over all intended cases, and grading failures/skips. Quality pass rate excludes review; its denominator is pass + fail. Mixed evaluator/policy versions suppress both mean score and pass rate. Counts remain visible; no global average mixes unrelated runs.

## Calibration and controlled comparisons

These tools only analyze saved data; they make no model or search calls. Run them from the project with its normal Node/pnpm environment. `.env.local` selects the same local or PostgreSQL storage as the app. Output files are created privately and are never overwritten.

```sh
# Generate a labeling template for a completed run.
pnpm exec tsx scripts/evaluation-report.ts template RUN_ID labels.json

# After independent review and adjudication, evaluate held-out agreement.
pnpm exec tsx scripts/evaluation-report.ts calibrate RUN_ID labels.json calibration-report.json

# Compare completed baseline and candidate runs on identical cases/contracts.
pnpm exec tsx scripts/evaluation-report.ts compare BASELINE_RUN_ID CANDIDATE_RUN_ID comparison.json

# Check the last three matching judge attempts for each saved answer.
pnpm exec tsx scripts/evaluation-report.ts stability RUN_ID stability.json
```

Calibration procedure:

1. Domain owners select 60–100 representative cases, including critical failures, numeric/unit errors, partial answers, multilingual paraphrases, missing references, injection and appropriate refusals. This is a pilot size, not a power guarantee.
2. Two reviewers independently record their judgments, then an adjudicator resolves disagreements. Preserve the independent annotations as supporting material; the template captures the final adjudicated labels and reviewer identities. It does not verify that reviewers worked independently.
3. Assign real `familyId` values and freeze calibration versus held-out splits before tuning. Paraphrases of one case stay in the same family. The report rejects any family shared across both splits. Tune only against calibration cases.
4. Mark `blockingViolation` when reviewers establish a consequential blocking claim, even if checklist requirements are met. Complete the four explanation-audit booleans based on actual evidence: quote provenance, semantic support, agreement with the computed decision, and supported corrective advice. Do not leave the template's default false/unknown values as if they were reviewed labels.
5. Inspect held-out requirement/decision agreement, coverage, folder/language slices, critical false passes and their 95% Wilson interval. Unknown/N/A labels are excluded from accuracy denominators, and semantic agreement is reported separately so deterministic checks cannot inflate judge accuracy. Pilot targets require at least 60 reviewed cases, at least 90% overall and semantic requirement agreement, no observed critical false passes with actual critical cases represented, and all explanation audits passing. The tool reports whether those targets are met; it never authorizes release automatically.
6. Preselect about 20 stability cases and regrade the same saved answers three times with unchanged requirements and judge settings. The stability report checks identical evidence and configuration. Repeated calls diagnose stability; they are not independent correctness evidence.

Paired comparisons require the same complete case set and project. Reference/requirement/policy/judge changes exclude that pair with a reason. Missing evaluations and review decisions remain explicit exclusions. Reports show improvements, regressions, unchanged cases, critical outcomes, folder/language slices, net pass-rate change and a Wilson interval for the improvement share among discordant pairs. That interval does not account for correlated case families. There is no automatic winner based on a small or selectively scored sample. Keep references and judge settings fixed when testing prompt changes; blind judgments omit prompt-variant identity.

Provider token usage, when returned, supports a measured campaign-cost estimate using the provider's actual rates. No price, token budget or judge accuracy is assumed by this implementation.

## CMS-style quality dimensions (draft rubric)

Alongside requirement evaluation, a run can enable the `dimensions-v1.0` suite: context_relevance, temporal_accuracy, completeness, no_answer_detection, hallucination_detection and citation_quality. In the review dialog, check **Evaluate CMS-style quality dimensions**, pick the dimensions, choose the missing-passage policy (strict: N/A excluded from pass rates; cms-compatible: N/A counts as PASS, matching the CMS export), and review or edit each dimension's judge prompt and thresholds before starting. Edited prompts show a Modified badge and a diff against the default; the safety wrapper and JSON output contract are fixed. The final prompts, thresholds and policy are frozen into the run's campaign; workers use only that snapshot.

Each dimension is judged independently (one judge call per dimension, one transport retry). A failed dimension is marked error and never counts as PASS; low-confidence verdicts become review. Code computes averages, ratios and pass decisions from validated judge rows; fabricated quotes are rejected. Overall PASS requires every applicable selected dimension to pass. The records page shows a per-dimension pass-rate table (CMS Summary-sheet shape) and per-record evidence; results are labeled **draft rubric, uncalibrated** until validated against human/CMS labels. Regrading reuses the frozen settings by default; the Runs-page regrade dialog can apply a new selection or edited prompts as a new campaign. Dimension grading needs the configured LLM evaluator but no approved criteria or expected answers.

## CMS export fixtures, agreement and CMS-format export

The committed fixture `tests/fixtures/cms-export-labels.json` holds 100 CMS benchmark cases × 2 models with CMS's per-dimension labels. The export has no passage content, so only temporal_accuracy, completeness and no_answer_detection can be re-judged from it; passage dimensions are N/A.

```sh
# Import saved answers (no Doc Search calls); --grade evaluates them with the configured evaluator.
pnpm cms:import tests/fixtures/cms-export-labels.json --grade [--limit N]

# Regrade imported runs through the normal engine path.
pnpm exec tsx scripts/regrade-run.ts RUN_ID [RUN_ID...]

# Per-dimension agreement with the CMS labels (excludes CMS judge errors and N/A).
pnpm exec tsx scripts/evaluation-report.ts cms-agreement RUN_ID tests/fixtures/cms-export-labels.json MODEL_NAME [out.json]

# CMS-compatible results.csv + summary.csv for one or two runs.
pnpm cms:export RUN_ID [SECOND_RUN_ID] outDir
```

Measured agreement (2026-11-22, draft rubric, qwen3.8-flash judge): temporal_accuracy 100%, completeness ~97%, no_answer_detection ~68–73% — the latter dominated by the clarification policy difference (the draft passes justified clarifications; CMS fails them). Agreement with CMS labels is not human ground truth; adjudicated human calibration is still required before release gating. Reports from the validation run are in `reports/`.

## Blind pairwise preference and dimension calibration

`pnpm preference:compare BASELINE_RUN_ID CANDIDATE_RUN_ID [out.json]` judges two completed runs on the same case set blind: A/B order is randomized per case, variant identity never reaches the judge, and identical answers auto-tie without a call. The comparison (draft rubric `preference-v1.0`, uncalibrated) is persisted in a bounded history of 20 and prints CMS-style win/tie/unknown rates. It makes evaluator calls, never search calls.

Calibration tools now cover dimensions too: `template` emits per-dimension label rows (status `unknown` until labeled) and works for criteria-free runs; `calibrate` computes per-dimension agreement and applies the ≥90% pilot target per track; `stability` checks the last three identical-configuration dimension attempts for row disagreement. Measured preference agreement with CMS labels was 76.1% (judge-vs-judge, not human ground truth); see `reports/preference-agreement.json`.

## Scope and remaining work

The software workflow is implemented; real domain approvals, independent human labeling, pilot model calls, held-out validation and production rollout are operational work that has not been performed by these code changes. No PostHog integration was installed. The existing benchmark implements the useful separation of code checks, judge checks, result types and evidence. Consider a platform integration only when production monitoring/review needs justify it.
