"use client";
import { useState } from "react";
import { promptLanguages, type PromptBaseline } from "@/lib/prompt-schema";

type LocalizedPrompt = NonNullable<PromptBaseline["agent_background_dto"]>;
export function PromptSectionEditor({
  label,
  item,
  changed,
  unavailable,
  disabled,
  onChange,
}: {
  label: string;
  item?: LocalizedPrompt;
  changed: boolean;
  unavailable?: string;
  disabled: boolean;
  onChange: (value: LocalizedPrompt) => void;
}) {
  const [language, setLanguage] = useState<"en" | "zh" | "sc">("en");
  const languageName = promptLanguages.find(([lang]) => lang === language)![1];
  return (
    <section
      className={`prompt-section-card${changed ? " prompt-changed" : ""}`}
      aria-label={label}
    >
      <header>
        <h3>{label}</h3>
        <span>
          {changed ? "Edited" : item ? "Loaded version" : "Unavailable"}
        </span>
      </header>
      {!item ? (
        <p>
          {unavailable || "Unavailable: include string en, zh and sc values."}
        </p>
      ) : (
        <fieldset disabled={disabled}>
          <legend className="sr-only">{label} editor</legend>
          <div
            className="prompt-language-tabs"
            role="group"
            aria-label={`${label} language`}
          >
            {promptLanguages.map(([lang, name]) => (
              <button
                type="button"
                key={lang}
                className={`button small ${language === lang ? "primary" : "secondary"}`}
                aria-pressed={language === lang}
                onClick={() => setLanguage(lang)}
              >
                {name}
              </button>
            ))}
          </div>
          <label>
            {languageName}
            <textarea
              aria-label={`${label} · ${languageName}`}
              value={item[language]}
              rows={8}
              maxLength={50000}
              onChange={(event) =>
                onChange({ ...item, [language]: event.target.value })
              }
            />
          </label>
        </fieldset>
      )}
    </section>
  );
}
