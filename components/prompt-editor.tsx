"use client";
import { useState } from "react";
import { localizedPromptSchema, type PromptOverrides } from "@/lib/schema";

const sections = [
  ["agent_background_dto", "Agent background"],
  ["custom_instruction_dto", "Custom instruction"],
  ["tool_call_context_dto", "Tool-call context"],
] as const;
const languages = [
  ["en", "English"],
  ["zh", "Traditional Chinese"],
  ["sc", "Simplified Chinese"],
] as const;
type Prompts = Partial<PromptOverrides>;

export function PromptEditor({
  projectId,
  folder,
  disabled,
  onChange,
}: {
  projectId: string;
  folder: string | null;
  disabled: boolean;
  onChange: (overrides: PromptOverrides | undefined, blocked: boolean) => void;
}) {
  const [json, setJson] = useState("");
  const [baseline, setBaseline] = useState<Prompts | null>(null);
  const [draft, setDraft] = useState<Prompts>({});
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState("");

  function notify(
    original: Prompts | null,
    current: Prompts,
    approved: boolean,
  ) {
    const changes: Prompts = {};
    for (const [key] of sections) {
      if (
        original?.[key] &&
        current[key] &&
        JSON.stringify(original[key]) !== JSON.stringify(current[key])
      )
        changes[key] = current[key];
    }
    const hasChanges = Object.keys(changes).length > 0;
    onChange(
      hasChanges && approved && folder
        ? (changes as PromptOverrides)
        : undefined,
      hasChanges && (!approved || !folder),
    );
  }
  function load() {
    try {
      const parsed: unknown = JSON.parse(json);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
        throw new Error("Paste a JSON object containing the prompt sections.");
      const original: Prompts = {};
      for (const [key] of sections) {
        const value = (parsed as Record<string, unknown>)[key];
        if (value !== undefined) {
          const result = localizedPromptSchema.safeParse(value);
          if (result.success) original[key] = result.data;
        }
      }
      if (!Object.keys(original).length)
        throw new Error(
          "No supported sections with all three language fields were found. Use a JSON object with en, zh and sc for each section.",
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
        Test revised prompts <span>Optional</span>
      </summary>
      <p>
        Import a CMS export as JSON. This app cannot retrieve prompts from CMS
        automatically. Overrides were verified on the development graph; verify
        application in your trace.
      </p>
      <p>
        Use an export for project{" "}
        <strong>{projectId || "(enter a project ID)"}</strong> and folder{" "}
        <strong>{folder || "(one folder required)"}</strong>. The CMS values may
        differ from the effective runtime prompt.
      </p>
      {!folder && (
        <p className="prompt-warning">
          Prompt testing requires a CSV with one folder. Standard benchmarks can
          still use multiple folders.
        </p>
      )}
      <label htmlFor="prompt-json">CMS prompt JSON</label>
      <p>
        Load the JSON after pasting it. Changing the JSON clears the loaded
        sections until it is loaded again.
      </p>
      <textarea
        id="prompt-json"
        value={json}
        disabled={disabled}
        onChange={(e) => {
          const value = e.target.value;
          setJson(value);
          setBaseline(null);
          setDraft({});
          setConfirmed(false);
          setError("");
          onChange(undefined, Boolean(value.trim()));
        }}
        placeholder={'{"agent_background_dto":{"en":"…","zh":"…","sc":"…"}}'}
        rows={4}
      />
      <button
        className="button secondary small"
        disabled={disabled || !json.trim()}
        onClick={load}
      >
        Load prompt sections
      </button>
      <button
        className="button secondary small"
        disabled={disabled}
        onClick={() => {
          setJson("");
          setBaseline(null);
          setDraft({});
          setConfirmed(false);
          setError("");
          onChange(undefined, false);
        }}
      >
        Clear prompt test
      </button>
      {error && (
        <p role="alert" className="prompt-warning">
          {error}
        </p>
      )}
      {baseline && (
        <>
          <p>
            Only supported sections with all three language fields are editable.
            Other sections in the export are not sent or modified. Empty
            baseline fields may represent server defaults.
          </p>
          {sections.map(([key, label]) => {
            const item = draft[key];
            return (
              <fieldset key={key} disabled={disabled || !item}>
                <legend>{label}</legend>
                {!item ? (
                  <p>Unavailable: export must include en, zh and sc.</p>
                ) : (
                  languages.map(([lang, language]) => (
                    <label key={lang}>
                      {language}
                      <textarea
                        value={item[lang]}
                        rows={3}
                        maxLength={50000}
                        onChange={(event) => {
                          const next = {
                            ...draft,
                            [key]: { ...item, [lang]: event.target.value },
                          };
                          setDraft(next);
                          notify(baseline, next, confirmed);
                        }}
                      />
                    </label>
                  ))
                )}
              </fieldset>
            );
          })}
          <label className="checkbox">
            <input
              type="checkbox"
              checked={confirmed}
              disabled={disabled || !folder}
              onChange={(e) => {
                setConfirmed(e.target.checked);
                notify(baseline, draft, e.target.checked);
              }}
            />{" "}
            I checked that this export matches the selected project and folder
            and includes the current en, zh and sc values.
          </label>
          <p>
            Changed sections send all three languages and disable the Doc Search
            cache. Unchanged sections are omitted. No CMS settings are changed.
          </p>
        </>
      )}
    </details>
  );
}
