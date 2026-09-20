import {
  BAND_LABELS,
  analysisSource,
  matchBand,
  matchGaps,
  matchReasons,
  matchScore,
  matchSummary,
  skillsMatchedCount,
  type Presentable,
} from "../../match";

/** The ring around the percentage. A circle's circumference, dashed to the value. */
function Ring({ pct, band }: { pct: number; band: string }) {
  const radius = 46;
  const circumference = 2 * Math.PI * radius;
  return (
    <svg className="ring" viewBox="0 0 112 112" width="112" height="112" role="img"
         aria-label={`${pct}% match, ${band}`}>
      <circle cx="56" cy="56" r={radius} className="ring-track" />
      <circle
        cx="56"
        cy="56"
        r={radius}
        className="ring-value"
        strokeDasharray={`${(pct / 100) * circumference} ${circumference}`}
        // start at twelve o'clock rather than three
        transform="rotate(-90 56 56)"
      />
      <text x="56" y="52" className="ring-pct" textAnchor="middle">{pct}</text>
      <text x="56" y="70" className="ring-unit" textAnchor="middle">%</text>
    </svg>
  );
}

/**
 * The AI Analysis panel. Where the LLM has run this is its own output; where
 * it has not, everything is derived from the scorer's signals. The header says
 * which, because "AI recommendation" over a template would be a lie.
 */
export function Analysis({ job }: { job: Presentable & { title: string } }) {
  const pct = matchScore(job);
  const band = matchBand(pct);
  const live = analysisSource(job) === "llm";
  const reasons = matchReasons(job);
  const gaps = matchGaps(job);
  const skills = skillsMatchedCount(job);

  return (
    <section className="panel ai-panel">
      <header>
        <span className="dot" data-state="running" aria-hidden="true" />
        <h3>AI Analysis</h3>
        <span className="sub">{live ? "live analysis" : "derived from signals"}</span>
      </header>

      <div className="ai-score">
        <Ring pct={pct} band={BAND_LABELS[band]} />
        <div>
          <b className="ai-band" data-band={band}>{BAND_LABELS[band]}</b>
          <span className="ai-skills">
            {skills.matched} of {skills.total} key skills found in your profile
          </span>
        </div>
      </div>

      {reasons.length > 0 ? (
        <>
          <h4 className="ai-label">Why this matches</h4>
          <ul className="ai-list">
            {reasons.map((reason) => (
              <li key={reason}>
                <span className="tick" aria-hidden="true">✓</span>
                {reason}
              </li>
            ))}
          </ul>
        </>
      ) : null}

      {gaps.length > 0 ? (
        <>
          <h4 className="ai-label">Potential gaps</h4>
          <ul className="ai-list gaps">
            {gaps.map((gap) => (
              <li key={gap}>
                <span className="tick" aria-hidden="true">!</span>
                {gap}
              </li>
            ))}
          </ul>
        </>
      ) : null}

      <h4 className="ai-label">{live ? "AI recommendation" : "Summary"}</h4>
      <p className="ai-summary">{matchSummary(job)}</p>
    </section>
  );
}
