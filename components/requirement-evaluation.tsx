import type { Evaluation } from "@/lib/schema";
export function EvaluationScore({ evaluation }: { evaluation?: Evaluation }) {
  if (!evaluation) return <>—</>;
  const r = evaluation.requirements;
  if (!r)
    return (
      <>
        {evaluation.score === null ? "—" : `${evaluation.score}%`}
        <small>Legacy holistic score</small>
      </>
    );
  return (
    <>
      {r.applicableWeight === 0
        ? "N/A"
        : evaluation.score === null
          ? `${r.lowerBound}–${r.upperBound}%`
          : `${evaluation.score}%`}
      <small className="evaluation-decision">{r.decision}</small>
    </>
  );
}
export function RequirementEvidence({
  evaluation,
}: {
  evaluation: Evaluation;
}) {
  const r = evaluation.requirements;
  if (!r)
    return (
      <p className="muted">
        Legacy holistic evaluation. This is not a measured proportion of
        requirements fulfilled.
      </p>
    );
  return (
    <section>
      <p>
        <strong>{r.decision.toUpperCase()}</strong> · {r.earnedWeight} /{" "}
        {r.applicableWeight} weighted points · Criteria {r.criteriaVersion} ·
        Policy {r.policyVersion}
      </p>
      <p className="muted">
        Evidence quotes are verified. Semantic judgments have not been verified
        by a human. Retrieval grounding: {r.grounding.status} —{" "}
        {r.grounding.explanation}
      </p>
      {r.rows.map((row) => (
        <div className="requirement-row" key={row.requirementId}>
          <strong>
            {row.requirementId}: {row.applicable ? row.status : "N/A"}
          </strong>{" "}
          · weight {row.weight}
          {row.critical ? " · critical" : ""}
          {row.credit !== null ? ` · credit ${row.credit}` : ""}
          <p>{row.difference}</p>
          <blockquote>
            Answer: {row.answerQuote ?? "No supporting quote supplied."}
          </blockquote>
          <blockquote>Approved reference: {row.referenceQuote}</blockquote>
        </div>
      ))}
      {r.claims.map((c, i) => (
        <div className="requirement-row" key={i}>
          <strong>
            {c.category} · {c.status}
          </strong>
          <blockquote>{c.answerQuote}</blockquote>
          <p>{c.explanation}</p>
          {c.reference && (
            <blockquote>Reference: {c.reference.quote}</blockquote>
          )}
        </div>
      ))}
      {r.grounding.evidence.map((e, i) => (
        <blockquote key={i}>
          Passage {e.sourceIndex + 1}: {e.quote} — Answer: {e.answerQuote}
        </blockquote>
      ))}
    </section>
  );
}
