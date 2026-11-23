import { mkdir, readFile, writeFile, rename, open } from "node:fs/promises";
import path from "node:path";
import lockfile from "proper-lockfile";
import { randomUUID, createHash } from "node:crypto";
import {
  stateSchema,
  createRunSchema,
  configSchema,
  type State,
  type Run,
  type CreateRunInput,
  type Question,
} from "./schema";
import { databaseMode, workflowMode, isVercel } from "./runtime";
import { databaseTransaction, readDatabaseSnapshot } from "./postgres-store";
import { validateModelSelection } from "./model-catalog";
import { createComparisonConfig } from "./comparison";
import { DIMENSION_NAMES } from "./dimension-contract";
import { searchConfig } from "./doc-search";
import {
  assertSnapshotScope,
  canonicalJson,
  checkPromptSnapshot,
  getPromptSnapshot,
} from "./cms-prompts";
import { changedPrompts, type PromptSnapshot } from "./prompt-schema";
import { CmsError, type CmsReadAccess } from "./cms-client";
import { evaluatorConfig } from "./evaluator";
import { createCampaign } from "./evaluation-snapshot";
import {
  validateCriteriaReferences,
  attachCriteria,
  criteriaSchema,
  needsJudge,
  type Criteria,
} from "./evaluation-contract";
import type {
  DimensionSelection,
  DimensionCampaign,
} from "./evaluation-dimensions";
import {
  dimensionSelectionSchema,
  type DimensionSelectionInput,
} from "./dimension-contract";
import {
  preferenceComparisonSchema,
  type PreferenceComparison,
} from "./preference-contract";
export const dataDir = () =>
  process.env.DATA_DIR || path.join(process.cwd(), "data");
export class ConflictError extends Error {}
function validateApprovedReferences(q: Question) {
  try {
    validateCriteriaReferences(q);
  } catch (e) {
    throw new ConflictError((e as Error).message);
  }
}
function campaignFor(
  questions: Question[],
  dimensionSelection?: DimensionSelection,
  reuseDimensions?: DimensionCampaign,
  model?: string,
) {
  let config: ReturnType<typeof evaluatorConfig> = null;
  try {
    if (questions.some(needsJudge) || dimensionSelection || reuseDimensions)
      config = evaluatorConfig();
    if (config && model) config = { ...config, model };
  } catch {
    /* Search remains usable; grading reports missing/invalid configuration. */
  }
  return createCampaign(questions, config, dimensionSelection, reuseDimensions);
}
export async function transaction<T>(
  fn: (state: State) => T | Promise<T>,
): Promise<T> {
  if (databaseMode()) return databaseTransaction(fn);
  const dir = dataDir();
  await mkdir(dir, { recursive: true });
  const release = await lockfile.lock(path.join(dir, "state.json"), {
    realpath: false,
    lockfilePath: path.join(dir, ".state.lock"),
    stale: 15000,
    update: 3000,
    retries: { retries: 100, minTimeout: 20, maxTimeout: 100 },
  });
  try {
    let state: State;
    let saved: string | null = null;
    try {
      saved = await readFile(path.join(dir, "state.json"), "utf8");
      state = stateSchema.parse(JSON.parse(saved));
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
      state = { version: 1, runs: [] };
    }
    const result = await fn(state);
    const serialized = JSON.stringify(stateSchema.parse(state));
    if (serialized === saved) return structuredClone(result);
    const temp = path.join(dir, `.${randomUUID()}.tmp`);
    await writeFile(temp, serialized, { mode: 0o600 });
    const handle = await open(temp, "r+");
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(temp, path.join(dir, "state.json"));
    return structuredClone(result);
  } finally {
    await release();
  }
}
export async function readState() {
  if (databaseMode()) return readDatabaseSnapshot();
  return transaction((s) => s);
}
export function finishRuns(s: State) {
  for (const r of s.runs) {
    if (
      r.status === "active" &&
      (!r.comparisons ||
        r.comparisons.every(
          (p) => !["pending", "running"].includes(p.status),
        )) &&
      r.records.every(
        (x) =>
          ["succeeded", "failed", "interrupted"].includes(x.execution) &&
          ["succeeded", "failed", "skipped"].includes(x.evaluationStatus),
      )
    ) {
      r.status = r.records.some((x) => x.execution === "interrupted")
        ? "interrupted"
        : "completed";
      r.finishedAt = new Date().toISOString();
    }
  }
}
export function recover(s: State) {
  for (const run of s.runs) {
    if (run.status !== "active") continue;
    for (const r of run.records) {
      if (["queued", "running"].includes(r.execution)) {
        r.execution = "interrupted";
        r.error = "Server restarted before this request completed. Not resent.";
        r.finishedAt = new Date().toISOString();
      }
      if (["pending", "running"].includes(r.evaluationStatus)) {
        r.evaluationStatus = "skipped";
        r.evaluationReason =
          "Server restarted; retry evaluation against the saved answer.";
        for (const a of r.attempts)
          if (a.status === "running") {
            a.status = "failed";
            a.error = "Worker interrupted by restart.";
            a.finishedAt = new Date().toISOString();
          }
      }
    }
    interruptComparisons(
      run,
      "Worker interrupted. Retry comparisons against saved answers.",
    );
    run.status = "interrupted";
    run.finishedAt = new Date().toISOString();
  }
}
export async function createRun(
  input: CreateRunInput,
  kind: Run["kind"] = "batch",
  cmsAccess?: (projectId: string) => Promise<CmsReadAccess | undefined>,
) {
  const body = createRunSchema.parse(input),
    config = configSchema.parse({
      ...searchConfig(),
      ...(body.projectId === undefined ? {} : { projectId: body.projectId }),
      generationModels: body.generationModels,
      evaluatorModel: body.evaluatorModel,
      ...(body.promptOverrides === undefined
        ? {}
        : { promptOverrides: body.promptOverrides }),
    });
  // Manual overrides apply to one document folder; a CMS selection uses its snapshot's folder below.
  if (body.promptOverrides && !body.promptSelection)
    config.promptScopeFolder =
      body.promptDocumentFolder ?? body.questions[0].folder;
  if (isVercel() && config.timeoutMs > 180000)
    throw new ConflictError(
      "Hosted Doc Search timeout must not exceed 180000 ms.",
    );
  const savedState = body.promptSelection ? await readState() : undefined;
  const savedSubmission = savedState?.runs.find(
    (r) => r.idempotencyKey === body.idempotencyKey,
  );
  const identitySnapshot =
    savedSubmission?.config.promptProvenance?.snapshot ??
    savedState?.promptSnapshots?.find(
      (s) => s.id === body.promptSelection?.snapshotId,
    );
  const hashInput = {
    questions: body.questions,
    concurrency: body.concurrency,
    kind,
    ...(body.projectId === undefined ? {} : { projectId: body.projectId }),
    ...(body.promptOverrides === undefined
      ? {}
      : { promptOverrides: body.promptOverrides }),
    ...(body.promptDocumentFolder === undefined
      ? {}
      : { promptDocumentFolder: body.promptDocumentFolder }),
    ...(body.dimensions === undefined ? {} : { dimensions: body.dimensions }),
    ...(body.generationModels
      ? { generationModels: body.generationModels }
      : {}),
    ...(body.evaluatorModel ? { evaluatorModel: body.evaluatorModel } : {}),
    ...(body.promptSelection
      ? {
          promptSelection: body.promptSelection,
          baselineIdentity: identitySnapshot
            ? {
                projectId: identitySnapshot.projectId,
                documentFolder: identitySnapshot.documentFolder,
                promptFolder: identitySnapshot.promptFolder,
                environment: identitySnapshot.environment,
                searchEndpoint: identitySnapshot.searchEndpoint,
                fingerprint: identitySnapshot.fingerprint,
                version: identitySnapshot.version,
                versionId: identitySnapshot.versionId,
                isBase: identitySnapshot.isBase,
              }
            : null,
          useCache: false,
        }
      : {}),
  };
  const requestHash = createHash("sha256")
    .update(
      body.promptSelection
        ? canonicalJson(hashInput)
        : JSON.stringify(hashInput),
    )
    .digest("hex");
  // Repeated submissions return the persisted run without requiring upstream discovery again.
  if (body.generationModels || body.evaluatorModel) {
    const prior = (await readState()).runs.find(
      (r) => r.idempotencyKey === body.idempotencyKey,
    );
    if (prior) {
      if (prior.requestHash !== requestHash)
        throw new ConflictError(
          "This submission key was already used for a different batch.",
        );
      return prior.id;
    }
    const access = body.generationModels
      ? await cmsAccess?.(config.projectId)
      : undefined;
    await validateModelSelection(
      body.generationModels,
      body.evaluatorModel,
      config.projectId,
      access?.credentials,
    );
    if (body.evaluatorModel && !evaluatorConfig())
      throw new ConflictError(
        "Configure the evaluator endpoint and key before selecting an evaluator.",
      );
  }
  let snapshot: PromptSnapshot | undefined;
  if (body.promptSelection) {
    // Completed submissions remain retryable after auth/snapshot expiry, without more upstream reads.
    const prior = savedSubmission;
    if (prior) {
      if (prior.requestHash !== requestHash)
        throw new ConflictError(
          "This submission key was already used for a different batch.",
        );
      return prior.id;
    }
    snapshot = await getPromptSnapshot(body.promptSelection.snapshotId);
    if (
      body.promptDocumentFolder !== undefined &&
      body.promptDocumentFolder !== snapshot.documentFolder
    )
      throw new ConflictError(
        "The prompt test's document folder does not match the loaded prompt. Load it again.",
      );
    assertSnapshotScope(snapshot, config.projectId, [
      ...new Set(body.questions.map((q) => q.folder)),
    ]);
    for (const key of Object.keys(body.promptOverrides ?? {})) {
      if (!snapshot.baseline[key as keyof typeof snapshot.baseline])
        throw new ConflictError(
          "Cannot override a section unavailable in the loaded CMS baseline.",
        );
    }
    const overrides = changedPrompts(snapshot.baseline, {
      ...snapshot.baseline,
      ...body.promptOverrides,
    });
    if (overrides) config.promptOverrides = overrides;
    else delete config.promptOverrides;
    const check = await checkPromptSnapshot(
      snapshot,
      await cmsAccess?.(config.projectId),
    );
    if (check.changed && !body.promptSelection.allowStale)
      throw new CmsError(
        "CMS changed since this prompt was loaded. Check the source, reload it, or acknowledge using the saved baseline.",
        409,
        "CMS_BASELINE_CHANGED",
      );
    config.promptScopeFolder = snapshot.documentFolder;
    config.promptProvenance = {
      snapshot,
      checkedAt: check.checkedAt,
      staleAcknowledged: check.changed,
    };
  }
  return transaction((s) => {
    const prior = s.runs.find((r) => r.idempotencyKey === body.idempotencyKey);
    if (prior) {
      if (prior.requestHash !== requestHash)
        throw new ConflictError(
          "This submission key was already used for a different batch.",
        );
      return prior.id;
    }
    if (snapshot)
      assertSnapshotScope(snapshot, config.projectId, [
        ...new Set(body.questions.map((q) => q.folder)),
      ]);
    if (s.runs.some((r) => r.status === "active"))
      throw new ConflictError(
        "A run or connectivity test is active. Wait for both queues to finish.",
      );
    for (const q of body.questions) {
      validateApprovedReferences(q);
      if (q.criteria && q.criteria.projectId !== config.projectId)
        throw new ConflictError(
          "Criteria project must match the selected project.",
        );
    }
    const caseIds = body.questions.flatMap((q) =>
      q.criteria ? [q.criteria.caseId] : [],
    );
    if (new Set(caseIds).size !== caseIds.length)
      throw new ConflictError("Case IDs must be unique.");
    // Defense in depth: clients cannot bypass upload normalization or duplicate checks.
    const keys = body.questions.map((q) => JSON.stringify([q.query, q.folder]));
    if (new Set(keys).size !== keys.length)
      throw new ConflictError(
        "Duplicate query/folder pairs. Review the CSV again.",
      );
    const id = randomUUID(),
      now = new Date().toISOString();
    const comparing = kind === "batch" && body.generationModels?.length === 2;
    const campaign = campaignFor(
      body.questions,
      body.dimensions ??
        (comparing
          ? { names: [...DIMENSION_NAMES], naPolicy: "strict" }
          : undefined),
      undefined,
      body.evaluatorModel,
    );
    if (comparing && !campaign.dimensions?.judge)
      throw new ConflictError(
        "Configure an evaluator before starting a model comparison.",
      );
    config.evaluatorModel ??=
      campaign.dimensions?.judge?.model ?? campaign.evaluator?.model;
    const records = body.questions.flatMap((question) =>
      (body.generationModels ?? [undefined]).map((generationModel) => ({
        id: randomUUID(),
        runId: id,
        question,
        generationModel,
        execution: "queued" as const,
        evaluationStatus:
          kind === "test" ? ("skipped" as const) : ("pending" as const),
        evaluationReason:
          kind === "test" ? "Connectivity test only." : undefined,
        createdAt: now,
        attempts: [],
      })),
    );
    s.runs.push({
      id,
      idempotencyKey: body.idempotencyKey,
      requestHash,
      kind,
      createdAt: now,
      status: "active",
      concurrency: kind === "test" ? 1 : body.concurrency,
      config,
      campaign,
      records,
      ...(comparing
        ? {
            comparisonConfig: createComparisonConfig(campaign.dimensions!),
            comparisons: body.questions.map((_, i) => ({
              id: randomUUID(),
              recordIds: [records[i * 2].id, records[i * 2 + 1].id] as [
                string,
                string,
              ],
              status: "pending" as const,
              attempts: [],
            })),
          }
        : {}),
    });
    return id;
  });
}
export async function retryEvaluation(id: string, criteria?: Criteria) {
  return transaction((s) => {
    const run = s.runs.find((r) => r.records.some((x) => x.id === id)),
      record = run?.records.find((r) => r.id === id);
    if (!run || !record) throw new Error("Record not found.");
    if (record.execution !== "succeeded")
      throw new ConflictError(
        "Only saved successful answers can be evaluated.",
      );
    if ((workflowMode() || run.comparisons?.length) && run.status === "active")
      throw new ConflictError(
        "Wait until this run finishes before retrying its evaluation.",
      );
    if (["pending", "running"].includes(record.evaluationStatus))
      throw new ConflictError("Evaluation is already queued.");
    if (s.runs.some((r) => r.status === "active" && r.id !== run.id))
      throw new ConflictError("Another run is active. Wait for it to finish.");
    if (criteria && run.comparisons?.length)
      throw new ConflictError(
        "Regrade both model variants with the same criteria using a new benchmark.",
      );
    if (criteria) {
      const approved = criteriaSchema.parse(criteria);
      if (approved.projectId !== run.config.projectId)
        throw new ConflictError("Criteria project does not match this run.");
      if (
        run.records.some(
          (r) =>
            r.id !== id &&
            r.generationModel === record.generationModel &&
            r.question.criteria?.caseId === approved.caseId,
        )
      )
        throw new ConflictError("Case ID is already used in this run.");
      const question = { ...record.question, criteria: approved };
      validateApprovedReferences(question);
      record.question = question;
    }
    const priorDimensions =
      record.attempts.at(-1)?.campaign?.dimensions ?? run.campaign?.dimensions;
    if (!record.question.criteria && !priorDimensions)
      throw new ConflictError(
        "Import approved requirements or enable dimension evaluation before regrading this answer.",
      );
    // A new campaign preserves the old attempt snapshots and never regenerates the answer.
    const campaign = campaignFor(
      [record.question],
      undefined,
      priorDimensions,
      run.config.evaluatorModel,
    );
    if (
      !campaign.evaluator &&
      needsJudge(record.question) &&
      !campaign.dimensions
    )
      throw new ConflictError("Configure the evaluator before regrading.");
    record.queuedCampaign = campaign;
    run.generation = (run.generation ?? 0) + 1;
    delete run.workflowRunId;
    delete run.dispatchError;
    record.evaluationStatus = "pending";
    delete record.evaluation;
    delete record.dimensionSuite;
    delete record.evaluationReason;
    run.status = "active";
    delete run.finishedAt;
    return record.id;
  });
}

/** Regrade saved answers as one frozen campaign, without issuing any search calls. */
export async function regradeRun(
  id: string,
  sidecar?: unknown,
  dimensionSelection?: DimensionSelectionInput,
) {
  const selection = dimensionSelection
    ? dimensionSelectionSchema.parse(dimensionSelection)
    : undefined;
  return transaction(async (s) => {
    const run = s.runs.find((r) => r.id === id);
    if (!run || run.kind !== "batch")
      throw new ConflictError("Batch run not found.");
    if (s.runs.some((r) => r.status === "active"))
      throw new ConflictError(
        "Wait for the active run to finish before regrading.",
      );
    if (sidecar !== undefined && run.comparisons?.length)
      throw new ConflictError(
        "Use a new benchmark to change criteria for paired models.",
      );
    let questions: Question[];
    try {
      questions =
        sidecar === undefined
          ? run.records.map((r) => r.question)
          : attachCriteria(
              run.records.map((r) => r.question),
              sidecar,
              run.config.projectId,
            );
    } catch (e) {
      throw new ConflictError((e as Error).message);
    }
    const priorDimensions =
      run.campaign?.dimensions ??
      run.records.flatMap((r) => r.attempts).at(-1)?.campaign?.dimensions;
    if (questions.some((q) => !q.criteria) && !priorDimensions && !selection)
      throw new ConflictError(
        "Every case needs approved requirements. Supply a complete criteria sidecar.",
      );
    for (const q of questions) {
      validateApprovedReferences(q);
      if (q.criteria && q.criteria.projectId !== run.config.projectId)
        throw new ConflictError("Criteria project mismatch.");
    }
    const variantCaseIds = questions.map((q, i) =>
      q.criteria
        ? JSON.stringify([run.records[i].generationModel, q.criteria.caseId])
        : String(i),
    );
    if (new Set(variantCaseIds).size !== variantCaseIds.length)
      throw new ConflictError("Case IDs must be unique within each model.");
    if (!run.records.some((r) => r.execution === "succeeded" && r.result))
      throw new ConflictError("No saved successful answers to regrade.");
    const campaign = campaignFor(
      questions,
      selection,
      selection ? undefined : priorDimensions,
      run.config.evaluatorModel,
    );
    if (
      !campaign.evaluator &&
      questions.some(needsJudge) &&
      !campaign.dimensions
    )
      throw new ConflictError("Configure the evaluator before regrading.");
    run.records.forEach((record, i) => {
      record.question = questions[i];
      if (record.execution !== "succeeded" || !record.result) return;
      record.queuedCampaign = campaign;
      record.evaluationStatus = "pending";
      delete record.evaluation;
      delete record.dimensionSuite;
      delete record.evaluationReason;
    });
    if (run.comparisons?.length) {
      run.campaign = campaign;
      run.comparisonConfig = createComparisonConfig(campaign.dimensions!);
      for (const pair of run.comparisons) {
        pair.status = "pending";
        delete pair.rows;
        delete pair.reason;
      }
    }
    run.generation = (run.generation ?? 0) + 1;
    delete run.workflowRunId;
    delete run.dispatchError;
    delete run.finishedAt;
    run.status = "active";
    return { id: run.id, campaignId: campaign.id };
  });
}

/** Persist a blind preference comparison; the bounded history evicts the oldest. */
export async function savePreferenceComparison(
  comparison: PreferenceComparison,
) {
  const parsed = preferenceComparisonSchema.parse(comparison);
  return transaction((s) => {
    const list = s.preferenceComparisons ?? [];
    if (list.some((c) => c.id === parsed.id))
      throw new ConflictError("This comparison is already saved.");
    list.push(parsed);
    while (list.length > 20) list.shift();
    s.preferenceComparisons = list;
    return parsed.id;
  });
}

export function interruptComparisons(run: Run, reason: string) {
  for (const pair of run.comparisons ?? []) {
    if (!["pending", "running"].includes(pair.status)) continue;
    pair.status = "failed";
    pair.reason = reason;
    const attempt = pair.attempts.at(-1);
    if (attempt?.status === "running") {
      attempt.status = "failed";
      attempt.error = reason;
      attempt.finishedAt = new Date().toISOString();
    }
  }
}
export async function retryComparisons(id: string) {
  return transaction((s) => {
    const run = s.runs.find((r) => r.id === id);
    if (!run?.comparisonConfig || !run.comparisons?.length)
      throw new ConflictError("Comparison benchmark not found.");
    if (s.runs.some((r) => r.status === "active"))
      throw new ConflictError("Wait for the active benchmark to finish.");
    for (const pair of run.comparisons) {
      pair.status = "pending";
      delete pair.rows;
      delete pair.reason;
    }
    run.generation = (run.generation ?? 0) + 1;
    run.status = "active";
    delete run.finishedAt;
    delete run.workflowRunId;
    delete run.dispatchError;
    return run.id;
  });
}
