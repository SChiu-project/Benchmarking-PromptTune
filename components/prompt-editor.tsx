"use client";
import { useEffect, useRef, useState } from "react";
import {
  changedPrompts,
  cmsFolderListSchema,
  localizedPromptSchema,
  promptSections,
  promptSnapshotSchema,
  type PromptBaseline,
  type PromptOverrides,
  type PromptSnapshot,
  type PromptSelection,
} from "@/lib/prompt-schema";
import { api } from "../lib/api-client";
import { CmsAccess } from "./cms-access";
import { PromptSectionEditor } from "./prompt-section-editor";

// ROOT is the foundation of every folder: CMS appends a folder's prompt and
// documents after ROOT's. A ROOT prompt test therefore covers every question;
// any other source folder covers only the CSV questions in that folder.
export function promptCoverage(
  source: string,
  folderCounts: Record<string, number>,
) {
  const total = Object.values(folderCounts).reduce((a, b) => a + b, 0);
  return {
    total,
    covered: source === "ROOT" ? total : (folderCounts[source] ?? 0),
  };
}
export function PromptEditor({
  projectId,
  folderCounts,
  disabled,
  onChange,
}: {
  projectId: string;
  /** CSV questions per document folder. */
  folderCounts: Record<string, number>;
  disabled: boolean;
  onChange: (
    overrides: PromptOverrides | undefined,
    blocked: boolean,
    selection?: PromptSelection,
    documentFolder?: string,
  ) => void;
}) {
  const [mode, setMode] = useState<"cms" | "manual">("cms");
  const [promptFolder, setPromptFolder] = useState("ROOT");
  // The prompt source folder is also the snapshot's document scope.
  const scope = promptFolder.trim();
  const coverage = promptCoverage(scope, folderCounts);
  const [json, setJson] = useState("");
  const [baseline, setBaseline] = useState<PromptBaseline | null>(null);
  const [draft, setDraft] = useState<PromptBaseline>({});
  const [snapshot, setSnapshot] = useState<PromptSnapshot | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [checkStatus, setCheckStatus] = useState<
    "unchecked" | "unchanged" | "changed"
  >("unchecked");
  const [allowStale, setAllowStale] = useState(false);
  const [canReadCms, setCanReadCms] = useState(false);
  const [folderList, setFolderList] = useState<{
    projectId: string;
    folders: string[];
  } | null>(null);
  const [folderError, setFolderError] = useState("");
  const [folderRefresh, setFolderRefresh] = useState(0);
  const [pendingFolder, setPendingFolder] = useState<string | null>(null);
  const [sourceNeedsLoad, setSourceNeedsLoad] = useState(false);
  const request = useRef<AbortController | null>(null);
  useEffect(() => () => request.current?.abort(), []);
  useEffect(() => {
    if (!canReadCms || !projectId || mode !== "cms") return;
    const controller = new AbortController();
    api<unknown>(
      `/api/cms/folders?projectId=${encodeURIComponent(projectId)}`,
      { signal: controller.signal },
    )
      .then((raw) => {
        const listed = cmsFolderListSchema.parse(raw);
        if (listed.projectId !== projectId)
          throw new Error(
            "CMS returned folders for another project. Refresh the folder list.",
          );
        if (!controller.signal.aborted) {
          setFolderList(listed);
          setFolderError("");
        }
      })
      .catch((e) => {
        if (!controller.signal.aborted)
          setFolderError(
            e instanceof Error ? e.message : "Could not load CMS folders.",
          );
      });
    return () => controller.abort();
  }, [canReadCms, projectId, mode, folderRefresh]);
  const extractedFolders =
    canReadCms && folderList?.projectId === projectId ? folderList.folders : [];
  const sourceFolders = [
    ...new Set([
      "ROOT",
      ...extractedFolders,
      ...Object.keys(folderCounts),
      ...(promptFolder ? [promptFolder] : []),
    ]),
  ];
  const changes = baseline ? changedPrompts(baseline, draft) : undefined;
  const dirty = Boolean(changes);

  function notify(
    original: PromptBaseline | null,
    current: PromptBaseline,
    approved: boolean,
    loaded = snapshot,
    stale = allowStale,
    moved = checkStatus === "changed",
  ) {
    const overrides = original ? changedPrompts(original, current) : undefined;
    const blocked =
      Boolean(loaded || overrides) &&
      (!approved || !scope || (moved && !stale));
    onChange(
      blocked ? undefined : overrides,
      blocked,
      loaded ? { snapshotId: loaded.id, allowStale: stale } : undefined,
      loaded?.documentFolder ?? (overrides ? scope || undefined : undefined),
    );
  }
  function reset(nextMode = mode) {
    request.current?.abort();
    request.current = null;
    setBusy(false);
    setMode(nextMode);
    setBaseline(null);
    setDraft({});
    setSnapshot(null);
    setJson("");
    setConfirmed(false);
    setError("");
    setCheckStatus("unchecked");
    setAllowStale(false);
    setPendingFolder(null);
    setSourceNeedsLoad(false);
    onChange(undefined, false);
  }
  function switchFolder(next: string) {
    reset();
    setPromptFolder(next);
    setSourceNeedsLoad(true);
    // A previous snapshot must never be submitted as the newly selected source.
    onChange(undefined, true);
  }
  function chooseFolder(next: string) {
    if (next === promptFolder) return;
    if (dirty) setPendingFolder(next);
    else switchFolder(next);
  }
  async function loadCms() {
    if (!scope || !projectId || busy) return;
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setBusy(true);
    setError("");
    onChange(undefined, true);
    try {
      const raw = await api<unknown>("/api/cms/prompts/load", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          projectId,
          documentFolder: scope,
          promptFolder: scope,
        }),
      });
      if (controller.signal.aborted || request.current !== controller) return;
      const loaded = promptSnapshotSchema.parse(raw);
      if (
        loaded.projectId !== projectId ||
        loaded.documentFolder !== scope ||
        loaded.promptFolder !== scope
      )
        throw new Error(
          "Prompt source changed during loading. Load the selected source again.",
        );
      setSnapshot(loaded);
      setSourceNeedsLoad(false);
      setBaseline(loaded.baseline);
      setDraft(structuredClone(loaded.baseline));
      setConfirmed(false);
      setCheckStatus("unchanged");
      setAllowStale(false);
      notify(loaded.baseline, loaded.baseline, false, loaded, false, false);
    } catch (e) {
      if (!controller.signal.aborted) {
        setError(e instanceof Error ? e.message : "CMS loading failed.");
        onChange(undefined, true);
      }
    } finally {
      if (!controller.signal.aborted) setBusy(false);
    }
  }
  async function checkCms() {
    if (!snapshot || busy) return;
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setBusy(true);
    setError("");
    onChange(undefined, true);
    try {
      const result = await api<{ changed: boolean }>("/api/cms/prompts/check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({ snapshotId: snapshot.id }),
      });
      if (controller.signal.aborted || request.current !== controller) return;
      setCheckStatus(result.changed ? "changed" : "unchanged");
      setAllowStale(false);
      notify(baseline, draft, confirmed, snapshot, false, result.changed);
    } catch (e) {
      if (!controller.signal.aborted) {
        setError(e instanceof Error ? e.message : "CMS check failed.");
        onChange(undefined, true);
      }
    } finally {
      if (!controller.signal.aborted) setBusy(false);
    }
  }
  function loadManual() {
    try {
      const parsed: unknown = JSON.parse(json);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
        throw new Error("Paste a JSON object containing prompt sections.");
      const original: PromptBaseline = {};
      for (const [key] of promptSections) {
        const result = localizedPromptSchema.safeParse(
          (parsed as Record<string, unknown>)[key],
        );
        if (result.success) original[key] = result.data;
      }
      if (!Object.keys(original).length)
        throw new Error(
          "No supported sections with string en, zh and sc fields were found.",
        );
      setBaseline(original);
      setDraft(structuredClone(original));
      setConfirmed(false);
      setError("");
      onChange(undefined, false);
    } catch (e) {
      setBaseline(null);
      setDraft({});
      setConfirmed(false);
      onChange(undefined, true);
      setError(e instanceof Error ? e.message : "Invalid prompt JSON.");
    }
  }
  return (
    <details className="prompt-editor">
      <summary>
        Test revised prompts <span>Optional · CMS stays unchanged</span>
      </summary>
      <p>
        Load the stored CMS prompt, then edit temporary instructions for this
        test. Runtime defaults and other configuration can add instructions;
        verify application in your trace.
      </p>
      <p>
        Project: <strong>{projectId || "(enter a project ID)"}</strong> · Prompt
        source: <strong>{scope}</strong>
      </p>
      {pendingFolder && (
        <div role="alert" className="prompt-folder-confirm">
          <p>
            There are unsaved prompt edits. Switching folders will discard them.
          </p>
          <button
            type="button"
            className="button secondary small"
            disabled={disabled || busy}
            onClick={() => setPendingFolder(null)}
          >
            Keep current folder and edits
          </button>
          <button
            type="button"
            className="button secondary small"
            disabled={disabled || busy}
            onClick={() => switchFolder(pendingFolder)}
          >
            Discard edits and switch folder
          </button>
        </div>
      )}
      {mode === "cms" && (
        <CmsAccess
          projectId={projectId}
          disabled={disabled || busy}
          onAccessChange={setCanReadCms}
        />
      )}
      <label htmlFor="cms-prompt-folder">Prompt source folder</label>
      <select
        id="cms-prompt-folder"
        value={promptFolder}
        disabled={disabled || busy}
        onChange={(e) => {
          chooseFolder(e.target.value);
        }}
        aria-describedby="cms-folder-help"
      >
        {sourceFolders.map((name) => (
          <option key={name} value={name}>
            {name}
          </option>
        ))}
      </select>
      <p id="cms-folder-help">
        ROOT is the base for every folder. Revising ROOT tests all questions;
        revising another folder tests only the CSV questions in that folder.
        Folders come from this project’s CMS document list and the CSV. A listed
        folder may use base configuration if it has no saved prompt version.
      </p>
      {canReadCms && (
        <div className="prompt-actions">
          <button
            type="button"
            className="button secondary small"
            disabled={disabled || busy}
            onClick={() => {
              setFolderError("");
              setFolderRefresh((value) => value + 1);
            }}
          >
            Refresh CMS folders
          </button>
          {!extractedFolders.length && !folderError && (
            <span role="status">Reading project folders…</span>
          )}
        </div>
      )}
      {folderError && (
        <p role="alert" className="prompt-warning">
          {folderError} You can retry or enter a folder manually.
        </p>
      )}
      <details className="prompt-custom-folder">
        <summary>Use a folder not listed</summary>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            const next = String(
              new FormData(event.currentTarget).get("folder") || "",
            ).trim();
            if (next) chooseFolder(next);
          }}
        >
          <label>
            Other prompt source folder
            <input
              name="folder"
              required
              maxLength={500}
              disabled={disabled || busy}
            />
          </label>
          <button
            type="submit"
            className="button secondary small"
            disabled={disabled || busy}
          >
            Select folder
          </button>
        </form>
      </details>
      <p
        role="status"
        className={coverage.covered ? undefined : "prompt-warning"}
      >
        {coverage.covered === 0
          ? `No CSV questions are in ${scope}, so the revised prompt would not be used. Choose ROOT or a folder from the CSV.`
          : scope === "ROOT"
            ? `Applies to all ${coverage.total} question${coverage.total === 1 ? "" : "s"}. Every folder builds on ROOT: CMS appends a folder's prompt and documents after ROOT's.`
            : `Applies to the ${coverage.covered} of ${coverage.total} question${coverage.total === 1 ? "" : "s"} in ${scope} (ROOT plus ${scope}). The other questions run with their normal CMS prompts.`}
      </p>
      {mode === "cms" ? (
        <>
          {sourceNeedsLoad && (
            <p role="status">
              Folder changed. Load from CMS to view this source before running a
              prompt test, or clear the prompt test.
            </p>
          )}
          <div className="prompt-actions">
            {!snapshot && (
              <button
                className="button primary small"
                disabled={
                  disabled ||
                  busy ||
                  !projectId ||
                  !scope ||
                  !promptFolder.trim()
                }
                onClick={() => void loadCms()}
              >
                Load from CMS
              </button>
            )}
            {snapshot && (
              <>
                <button
                  className="button secondary small"
                  disabled={disabled || busy}
                  onClick={() => void checkCms()}
                >
                  Check CMS for changes
                </button>
                <button
                  className="button secondary small"
                  disabled={disabled || busy}
                  onClick={() => void loadCms()}
                >
                  {dirty
                    ? "Discard draft and reload from CMS"
                    : "Reload from CMS"}
                </button>
              </>
            )}
          </div>
          {busy && <p role="status">Reading CMS…</p>}
          {snapshot && (
            <div className="prompt-source">
              <strong>
                Stored CMS prompt ·{" "}
                {snapshot.isBase
                  ? "Base configuration (no saved folder version)"
                  : `Version ${snapshot.version}`}
              </strong>
              <p>
                Source folder: {snapshot.promptFolder} · Active:{" "}
                {snapshot.isActive ? "yes" : "no"}
                <br />
                Environment: {snapshot.environment}
                <br />
                Loaded: {new Date(snapshot.retrievedAt).toLocaleString()}
                <br />
                {snapshot.versionId && (
                  <>
                    Version ID: {snapshot.versionId}
                    <br />
                  </>
                )}
                Fingerprint: <code>{snapshot.fingerprint}</code>
              </p>
              {snapshot.isBase && (
                <p>
                  Version 0 denotes base configuration. It does not identify a
                  saved ROOT version. Runtime matching remains unverified.
                </p>
              )}
              <p role="status">
                {checkStatus === "changed"
                  ? "CMS changed after this snapshot was loaded."
                  : "Source matched at the last read. It is checked again before submission."}
              </p>
              {checkStatus === "changed" && (
                <label className="checkbox">
                  <input
                    type="checkbox"
                    checked={allowStale}
                    disabled={disabled || busy || Boolean(error)}
                    onChange={(e) => {
                      setAllowStale(e.target.checked);
                      notify(
                        baseline,
                        draft,
                        confirmed,
                        snapshot,
                        e.target.checked,
                        true,
                      );
                    }}
                  />
                  Use this saved baseline despite the CMS change. Unedited
                  sections still use current runtime configuration.
                </label>
              )}
            </div>
          )}
        </>
      ) : (
        <>
          <label htmlFor="prompt-json">CMS prompt JSON · manual fallback</label>
          <textarea
            id="prompt-json"
            value={json}
            rows={4}
            disabled={disabled}
            placeholder={
              '{"agent_background_dto":{"en":"…","zh":"…","sc":"…"}}'
            }
            onChange={(e) => {
              setJson(e.target.value);
              setBaseline(null);
              setDraft({});
              setConfirmed(false);
              setError("");
              onChange(undefined, Boolean(e.target.value.trim()));
            }}
          />
          <button
            className="button secondary small"
            disabled={disabled || !json.trim()}
            onClick={loadManual}
          >
            Load pasted sections
          </button>
        </>
      )}
      <div className="prompt-actions">
        <button
          className="button secondary small"
          disabled={disabled || busy}
          onClick={() => reset(mode === "cms" ? "manual" : "cms")}
        >
          {dirty ? "Discard draft and switch to " : "Use "}
          {mode === "cms" ? "manual JSON import" : "CMS loading"}
        </button>
        <button
          className="button secondary small"
          disabled={disabled}
          onClick={() => reset()}
        >
          {dirty
            ? "Discard draft and clear prompt test"
            : "Clear prompt test / run without overrides"}
        </button>
      </div>
      {error && (
        <p role="alert" className="prompt-warning">
          {error} Your draft is preserved. Retry, or clear the prompt test to
          run without overrides.
        </p>
      )}
      {baseline && (
        <>
          <p>
            Only complete en/zh/sc sections are editable. Empty text is
            preserved; it may represent a runtime default. Other CMS fields are
            not sent.
          </p>
          <div className="prompt-section-list">
            {promptSections.map(([key, label]) => (
              <PromptSectionEditor
                key={`${snapshot?.id || "manual"}:${key}`}
                label={label}
                item={draft[key]}
                changed={Boolean(changes?.[key])}
                unavailable={snapshot?.unavailable[key]}
                disabled={disabled || busy || Boolean(error)}
                onChange={(item) => {
                  const next = { ...draft, [key]: item };
                  setDraft(next);
                  notify(baseline, next, confirmed);
                }}
              />
            ))}
          </div>
          <button
            className="button secondary small"
            disabled={disabled || busy || Boolean(error) || !dirty}
            onClick={() => {
              const restored = structuredClone(baseline);
              setDraft(restored);
              notify(baseline, restored, confirmed);
            }}
          >
            Reset edits to loaded version
          </button>
          <label className="checkbox">
            <input
              type="checkbox"
              checked={confirmed}
              disabled={disabled || busy || !scope || Boolean(error)}
              onChange={(e) => {
                setConfirmed(e.target.checked);
                notify(baseline, draft, e.target.checked);
              }}
            />
            I checked the project, prompt source folder, the questions it
            applies to and the language values for this test.
          </label>
          <p>
            {changes
              ? `Changed sections: ${promptSections
                  .filter(([key]) => changes[key])
                  .map(([, label]) => label)
                  .join(", ")}.`
              : "No prompt edits: unchanged sections are omitted."}{" "}
            Changed sections send all three languages. CMS-backed tests bypass
            the answer cache, including unedited controls. CMS settings stay
            unchanged.
          </p>
        </>
      )}
    </details>
  );
}
