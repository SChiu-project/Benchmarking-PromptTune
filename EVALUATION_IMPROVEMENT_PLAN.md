# Draft: measurable fulfillment and evidence-based evaluation explanations

Date: 2026-11-15. Status: proposal for review; no application changes implemented.

Scope: the local `doc-search-benchmark` implementation. “Explanation” means the evaluator's justification for its grade. The chatbot's own explanation quality should become a task requirement only when the question calls for one. Findings below come from code and existing tests, not a new live benchmark or a production audit.

## The Verdict

**Solid Foundation.** Improve the existing evaluator before adding another evaluation platform. Its engineering safeguards are useful, but the current fulfillment percentage is a model judgment expressed as a number, rather than a measurement against a fixed set of requirements. A more persuasive explanation alone will not make that number trustworthy.

## The Stress Test

### What exists today

The current path is CSV question/reference/comments → Doc Search → separate LLM evaluator → schema validation → weighted score → record explanation and attempt history.

Verified implementation evidence:

- [`lib/evaluator.ts`](lib/evaluator.ts): `fulfillment-v1.0` asks for four holistic 0–100 scores, anchored at broad quality levels. Application code applies correctness 40%, coverage 30%, relevance 20%, compliance 10%, and renormalizes around null dimensions. The evaluator receives query, expected answer, comments and answer, but no retrieved passages or trace contents.
- [`lib/schema.ts`](lib/schema.ts): validates output structure and bounds. It does not require stable requirement IDs, verify quoted evidence, or enforce consistency between deductions and explanations. Run summaries average successfully scored records; execution and grading counts are separately available.
- [`lib/engine.ts`](lib/engine.ts) and [`lib/cloud-jobs.ts`](lib/cloud-jobs.ts): support local and hosted grading paths. Attempts record model, endpoint, rubric version and timing. They do not snapshot the complete judge prompt, decision policy or source pack. Full reproducibility is therefore limited.
- [`components/records.tsx`](components/records.tsx): already exposes explanations and detailed results. The problem is the evidence contract behind those fields, not simply a missing explanation UI.
- [`tests/core.test.ts`](tests/core.test.ts): verifies arithmetic, schema failures and mocked evaluator calls. Its accessibility fixture scores 83.3 despite missing required accessible directions. The injection test checks the constructed prompt with a mocked response; it does not establish that a real judge resists injection.

### Why the standard needs to change

1. **A score of 83.3 is not “83.3% of requirements fulfilled.”** No approved requirement denominator produces it. Decimal arithmetic makes the output look more precise than the judgment warrants.
2. **Averages can hide an unusable answer.** Correct location and relevance can compensate numerically for a missing route the user needs. There is no independent critical-requirement decision rule.
3. **Free-text criteria invite shifting interpretations.** Different judge runs can extract different obligations from the same expected answer and comments.
4. **Reference agreement and source grounding are different.** The current evaluator can compare against the supplied reference. It cannot verify grounding in passages it never receives. Retrieved text itself is also not automatically authoritative or sufficient.
5. **N/A can inflate apparent performance.** Dropping unknown correctness while retaining easy-to-score relevance can produce a high aggregate on weak evidence. Missing evidence is different from a genuinely inapplicable requirement.
6. **An articulate justification can still be wrong.** Schema validation establishes valid JSON, not valid deductions, faithful quotes or correct interpretation.
7. **Regrading can change the comparison basis.** Retry history is preserved, but summaries do not establish a common evaluator version across the scored records. Prompt improvements and judge changes must be measured separately.

### Lessons from PostHog

The [evaluation documentation](https://posthog.com/docs/ai-evals) distinguishes deterministic checks from LLM judgments, and boolean, numeric and categorical results. It supports explanations, N/A, evaluation at generation/trace/session scope, sampling, filters and historical re-evaluation. Passing-rule edits can reinterpret historical results; decision models omit written explanations. These are useful design patterns, not proof that an evaluator is calibrated.

The related [offline-eval](https://posthog.com/docs/ai-evals/offline-evals), [dataset](https://posthog.com/docs/ai-evals/datasets) and [trace-review](https://posthog.com/docs/ai-observability/trace-reviews) documentation is relevant to controlled comparisons and human review. The plan below is a project-specific recommendation, not a PostHog-prescribed rubric.

## Counter-Arguments

**“Another judge layer may only automate our biases.”** Correct. If references are incomplete or the approved requirements reward the wrong behavior, better tooling will consistently measure the wrong target. Domain review and a held-out human-labeled set must precede release decisions.

**“Atomic requirements create annotation overhead.”** Correct. Start with the most important existing questions; use an LLM to draft requirements once, then have a person approve them. Do not regenerate criteria separately for each candidate answer. Merge overlapping requirements so wording length does not determine weight.

**“The judge can game or misread a checklist too.”** Correct. Use paraphrases, contradictions, negation, multilingual variants, unsupported additions and injected instructions as challenge cases. Validate evidence mechanically where possible and escalate unresolved semantic judgments.

**“Why integrate PostHog if traces and benchmark storage already exist?”** There is no demonstrated need to migrate. A platform integration is justified only by a concrete monitoring or review gap after the local evaluation standard works. Instrumentation will not repair scoring validity.

## Application Example

Synthetic station example; the locations below are invented, not passenger guidance.

Question: “Where is the accessible toilet and how do I get there without stairs?” Approved reference: “Level 1, beside Lift A. Use Lift A from the concourse.” Response: “The toilet is on Level 1, beside Lift A.”

Approved requirements:

| ID | Requirement | Weight | Critical | Judgment |
| --- | --- | --- | --- | --- |
| R1 | Identify Level 1 | 2 | No | Met; exact response quote |
| R2 | Identify location beside Lift A | 1 | No | Met; exact response quote |
| R3 | Give the step-free route using Lift A from the concourse | 3 | Yes | Unmet; route instruction absent |

Fulfillment is `100 × (2 + 1 + 0) / (2 + 1 + 3) = 50%`. Release decision: **fail**, because R3 is critical and unmet. No extra penalty is needed for the same omission.

The explanation should say: “R1 and R2 are met: ‘on Level 1, beside Lift A.’ R3 is missing: the answer names the lift but gives no instruction to use it from the concourse. Add the approved step-free route. Fulfillment: 3 of 6 weighted points; fail because R3 is critical.”

This illustrates the proposed rule; the existing test's 83.3 concerns a different fixture. It is not a measured before/after result.

## The Fix

### 1. Freeze a requirement contract before grading

Keep the current CSV import compatible. Add a versioned criteria editor or optional JSON sidecar keyed by a stable case ID. Preserve the original reference/comments and their hashes.

Each approved requirement needs: `id`, text, evidence/reference location, applicability condition, positive weight, critical flag, check method and explicit partial-credit rule. Record project, folder, language and reference version. Resolve conflicts between reference and comments before grading; do not silently choose whichever makes scoring easier.

Use semantic evaluation for meaning. Use code for things code can establish: schema shape, length, exact mandatory phrases when explicitly required, allowed identifiers, and numeric checks. Quantitative answer requirements must specify units, rounding, absolute/relative tolerance and boundary behavior. Keyword presence alone cannot prove semantic correctness.

### 2. Replace holistic fulfillment with a computed requirement score

For each applicable requirement, return `met`, `partial`, `unmet`, or `unknown`. Applicability is determined by the approved contract and case inputs, not chosen opportunistically by the answer judge.

`Fulfillment = 100 × Σ(weight × credit) / Σ(applicable weight)`

- Met earns 1; unmet earns 0. Partial earns only the credit explicitly authorized in that requirement's rubric, such as 0.5. Without an approved partial anchor, use met/unmet or escalate ambiguity.
- Unknown means the evidence cannot establish the result. Keep its weight in scope and show a lower/upper fulfillment bound using credit 0/1. Do not present a definitive percentage or pass decision while required judgments remain unknown.
- Genuine N/A is excluded with a recorded applicability reason. No applicable requirements yields an unassessable result, never 100%.
- Preserve the old four dimensions as diagnostic views during migration. Do not combine the old weighted score with the new fulfillment percentage. Label historical records “legacy holistic score.”

A proposed initial decision policy is: **pass** when fulfillment is at least 85%, all critical requirements are met, and no blocking contradiction or prohibited claim is established; **fail** for a definitive blocking violation or a score below threshold; **review** when uncertainty prevents either conclusion. The 85% cutoff is a starting policy to calibrate with reviewers, not an empirical finding.

Nonrequired extra claims must be checked separately. Record a material contradiction or unsupported consequential claim as a failure category with evidence; a perfect checklist score must not hide dangerous invented advice. Domain reviewers define which categories block release.

### 3. Make every deduction auditable

Judge output should contain one row per approved requirement: requirement ID, status, credit where applicable, exact answer quote/span or explicit absence, reference/source ID and span, concise difference, and specific correction. Generate the overall explanation from these rows and the code-computed decision.

Server-side validators must reject unknown/duplicate/missing requirement IDs, unauthorized partial credit, invalid spans, fabricated quotes, and totals inconsistent with the judgment rows. A quote match proves provenance only; it does not prove the quote supports the judgment. Ambiguous entailment goes to human review.

Avoid treating “absent from reference” as “false.” Use distinct labels for contradiction, missing requirement, unsupported claim and unassessable claim. Make truncation or missing sources visible. Explanations should describe observable evidence and the scoring rule, without requesting private chain of thought.

Audit the explanation itself on four binary questions: Are cited spans real? Do they support the judgment? Does the explanation match the computed score/decision? Is the recommended correction supported by the approved material? Do not let explanation fluency raise the answer score.

### 4. Add the evidence needed for each evaluation scope

Extend the evaluator input beyond `(question, answer)` to an immutable evaluation bundle containing the criteria version, answer, approved reference pack, available retrieved passages and relevant metadata. Treat all embedded text as untrusted data.

Keep two separate assessments: **reference fulfillment** against approved requirements, and **retrieval grounding** against the returned passages. A passage conflict with the approved reference is a dataset/retrieval issue requiring review, not permission to overwrite ground truth. Missing passages make grounding unassessable, without invalidating separately supported reference judgments.

Use trace evidence for retrieval/tool diagnosis only when the underlying events are available and verified. A saved trace ID alone provides no visibility into tool behavior. The existing prompt-testing findings already distinguish stored CMS configuration from effective runtime prompts; preserve that distinction in comparisons.

### 5. Calibrate the evaluator before using it as a release gate

Start with 60–100 representative cases spanning projects, folders, languages and failure modes. This is a pilot size, not a guarantee of statistical power. Include correct paraphrases, partial answers, missing critical steps, numeric/unit errors, justified clarification/refusal, incomplete references and adversarial text.

Have a domain owner and a second reviewer independently label requirement outcomes, decision and explanation defects; adjudicate disagreements. Split calibration and held-out validation by case family, keeping paraphrases together to reduce leakage. Tune only on calibration cases.

Proposed pilot targets, to be revised against operational risk:

- At least 90% requirement-level agreement with adjudicated labels on the held-out set, also reported by language and task type.
- No observed critical false passes in the held-out critical cases. Report their count and an uncertainty interval; zero observed errors is not proof of zero risk.
- All accepted quoted spans pass mechanical provenance checks; separately audit semantic evidence support with reviewers.
- Run a preselected 20-case stability subset three times; report requirement and decision disagreement even at temperature 0. Treat repeated calls as a stability diagnostic, not independent evidence of correctness.

If disagreement concentrates on a requirement, repair its definition/reference before changing the judge. A second model is useful for triage, but model agreement is not a substitute for the adjudicated labels.

### 6. Make prompt comparisons and summaries defensible

Compare baseline and candidate on the same frozen cases, references, criteria, judge configuration and decision policy. Blind the judge to variant identity. Pair outcomes by stable case ID; use repeated generations only when the generation variance matters, and retain their grouping by case.

Show pass/fail/review counts, critical failures, fulfillment bounds, evaluation failures and coverage of the intended suite. Define quality pass rate as passed / definitively decided eligible cases, and always show the excluded review/unassessable count. Also show operational success over all attempted cases so missing answers cannot improve apparent performance.

For candidate selection, report paired decision changes and uncertainty across cases. Keep project/language/folder slices visible; do not pool incompatible criteria or evaluator versions. Small samples or mixed critical outcomes should yield an inconclusive decision, not an automatic winner based on average score.

### 7. Preserve evaluation provenance and history

Create a named evaluation campaign with dataset/reference/criteria hashes, full judge prompt hash and version, model identifier and available revision, endpoint, generation settings, evidence-pack hash, threshold/critical-policy version and code version. Snapshot configuration before dispatch in both local and hosted workers; record provider-returned model metadata when available.

Re-evaluate saved answers in a new campaign to compare rubric versions without regenerating responses. Keep all attempts. Never silently rewrite old pass/fail labels when thresholds change; display the policy used for each result. Preserve local JSON and PostgreSQL compatibility through versioned readers/migrations and fixtures.

### Delivery order and acceptance gates

| Phase | Accountable owner | Deliverable | Exit criterion |
| --- | --- | --- | --- |
| P0: define | Domain owner + benchmark maintainer | Approved pilot criteria, labeled cases and provisional decision policy | Reviewers can apply the rules consistently; conflicts are resolved |
| P1: measure | Benchmark maintainer | Versioned requirement schema, deterministic scorer and evidence validators | Critical omission, N/A, unknown bounds, contradiction and numeric-boundary cases behave as specified |
| P2: integrate | Benchmark maintainer | Immutable evaluation bundles, both worker paths, campaign persistence and explanation UI | Local/hosted parity; old runs remain readable; regrading preserves history |
| P3: validate | Domain reviewers | Held-out calibration report and paired baseline/candidate evaluation | Targets met or limitations explicitly block release gating |
| P4: monitor, optional | Product/operations owner | Scoped production sampling and human review queue | A demonstrated monitoring need and verified event mapping justify integration |

Likely implementation touchpoints: `lib/schema.ts`, `lib/evaluator.ts`, `lib/engine.ts`, `lib/cloud-jobs.ts`, storage adapters, record-list projections, CSV/criteria import, and record/run screens. Preserve the existing stack and use its Zod validation and trace infrastructure. Relevant application-reference concepts are runtime validation and tracing; no new platform dependency is needed for P0–P3.

Verification should include scoring/evidence edge cases, migration fixtures, local/hosted grading parity, regrade history and the held-out human audit. Existing mocked tests remain useful for integration contracts; they cannot establish judge accuracy. No implementation tests or paid model calls were run for this planning task.

### Optional PostHog adoption

Revisit integration only after P3. Use a representative production sample plus explicit high-risk slices, while grading all eligible offline benchmark cases. Keep deterministic checks in the current TypeScript service unless moving them has a specific benefit. If adopting PostHog, map canonical record/campaign IDs to verified generation/trace events and include the approved evaluation context; ordinary generation capture alone will not supply this project's ground truth.

Keep written explanations for the review workflow. Defer sentiment analysis: it does not establish fulfillment. Preserve canonical versioned decisions in the benchmark if external reporting applies changed passing rules retrospectively. Establish an actual per-campaign cost estimate from measured pilot tokens and evaluator calls before expanding volume.

The next concrete step is P0: approve a small requirement contract and human-labeled pilot before changing the evaluator prompt or building more dashboards.
