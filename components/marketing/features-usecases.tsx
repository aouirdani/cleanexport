/**
 * Ported from the reference's features-usecases.tsx: FeatureGrid, its
 * read-only callout, and UseCases are taken structurally as-is, with our
 * copy swapped in (8 features instead of the source's 6 - .feature-grid's
 * 3-column layout fits either count without changes, just an uneven last
 * row, same as the source would get with 7 or 8).
 *
 * Dropped entirely: the source's third export, `Comparison` - an 8-row
 * "manual CSV vs. CleanExporter" feature checklist. We have no verified
 * copy for that specific checklist (which claim gets a checkmark on which
 * row), and our actual comparison content is a four-row PRICE table
 * (COMPARE_ROWS), a different shape of data - that lives in the pricing
 * section instead (see pricing-faq.tsx), styled in its own visual
 * language rather than forced into this component's checkbox-table rules.
 *
 * Read-only callout's body copy is pulled verbatim from our FAQ's "What
 * access do you need?" answer rather than paraphrased, so it stays a
 * verified claim instead of a fresh one.
 */
import { Icon, type IconName } from "./icons"

const FEATURES: { icon: IconName; title: string; desc: string }[] = [
  { icon: "globe", title: "Accents survive", desc: "HubSpot's CSV gives you PremiÃ¨re ligne. Ours gives you Première ligne." },
  { icon: "file", title: "One row per record", desc: "Line breaks in Notes or multi-line fields stay inside the cell - never split across rows." },
  { icon: "calendar", title: "Real Excel dates", desc: "Date fields are real date values - sortable, filterable, usable in formulas." },
  { icon: "users", title: "Owner names, not IDs", desc: "Owner columns show a name, not an 8-digit numeric ID you have to decode." },
  { icon: "hash", title: "IDs kept as text", desc: "Record IDs are stored as text so Excel can't silently round them into a different ID." },
  { icon: "columns", title: "Your column order", desc: "Drag properties into any order. CleanExporter never rearranges them behind your back." },
  { icon: "clock", title: "Scheduled delivery", desc: "Daily, weekly, or monthly. Your file arrives without you lifting a finger." },
  { icon: "filter", title: "Filters & associated columns", desc: "Export only the records you need, and pull in an associated company or contact's columns too." },
]

export function FeatureGrid() {
  return (
    <section id="features" className="section features-section" aria-labelledby="features-heading">
      <div className="container">
        <div className="section-heading split-heading">
          <div>
            <span className="eyebrow">What you get</span>
            <h2 id="features-heading">Everything your export should be</h2>
          </div>
          <p>CleanExporter does one thing and does it right: a file that is correct.</p>
        </div>
        <div className="feature-grid">
          {FEATURES.map((feature) => (
            <article key={feature.title} className="feature-item reveal-card">
              <span className="feature-icon">
                <Icon name={feature.icon} size={23} />
              </span>
              <h3>{feature.title}</h3>
              <p>{feature.desc}</p>
            </article>
          ))}
        </div>
        <aside className="read-only-callout">
          <span className="read-only-icon">
            <Icon name="shield" size={27} />
          </span>
          <div>
            <h3>Your CRM stays exactly as it is.</h3>
            <p>Read-only. We request no write scope on contacts, companies, or deals. You can revoke access from HubSpot at any time.</p>
          </div>
          <span className="read-only-label">
            <Icon name="lock" size={13} />
            READ-ONLY BY DESIGN
          </span>
        </aside>
      </div>
    </section>
  )
}

const PERSONAS: { icon: IconName; title: string; desc: string }[] = [
  { icon: "chart", title: "RevOps teams", desc: "A weekly deal export, ready before the Monday pipeline review - every time, without anyone pulling it from HubSpot by hand." },
  { icon: "mail", title: "Marketing ops", desc: "Contact lists with Notes and other multi-line fields intact - no rows broken apart before a campaign." },
  { icon: "building", title: "HubSpot agencies", desc: "The same export definition, running on schedule across every client portal you manage." },
  { icon: "wallet", title: "Finance", desc: "Deal amounts and close dates in a sortable sheet - real numbers and real dates, not text to clean up first." },
]

export function UseCases() {
  return (
    <section id="who-its-for" className="section use-cases-section" aria-labelledby="who-heading">
      <div className="container">
        <div className="section-heading centered">
          <span className="eyebrow">Who it&apos;s for</span>
          <h2 id="who-heading">Who uses CleanExporter</h2>
          <p>Different teams. The same Monday morning problem.</p>
        </div>
        <div className="use-case-grid">
          {PERSONAS.map((persona) => (
            <article key={persona.title} className="use-case-card reveal-card">
              <Icon name={persona.icon} size={27} />
              <h3>{persona.title}</h3>
              <p>{persona.desc}</p>
            </article>
          ))}
        </div>
      </div>
    </section>
  )
}
