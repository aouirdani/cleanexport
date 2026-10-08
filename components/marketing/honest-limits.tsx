/**
 * Not from the reference - it has no equivalent section. Our own content
 * (verified, unchanged), given its own section in the reference's visual
 * language: .section/.section-heading/.eyebrow are shared with the rest
 * of the page, .limits-list/.limits-section are new rules added to
 * landing.css for this content alone.
 */
const HONEST_LIMITS = [
  "We can't import an existing HubSpot dashboard report — no API exposes that data. You rebuild the export once here, and then it runs forever.",
  "Excel output only for now. CSV and JSON are coming.",
  "One portal per account today. Agency multi-portal is next.",
]

export function HonestLimits() {
  return (
    <section className="section limits-section">
      <div className="container">
        <div className="section-heading">
          <span className="eyebrow">Honest limits</span>
          <h2>What to know before you connect</h2>
          <p>CleanExporter focuses on Excel exports from a single HubSpot portal.</p>
        </div>
        <ul className="limits-list">
          {HONEST_LIMITS.map((limit) => (
            <li key={limit}>
              <span aria-hidden="true">—</span>
              <span>{limit}</span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  )
}
