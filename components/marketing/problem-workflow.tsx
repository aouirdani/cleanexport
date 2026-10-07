/**
 * Ported from the reference's problem-workflow.tsx (ProblemSection +
 * Workflow). Structure, card/step markup and the first workflow step's
 * HubSpotMark treatment are unchanged. Adapted: our copy has six problems,
 * not the reference's four, so .problem-grid gets the --3col modifier
 * (landing.css) instead of its 4-column default - a straight grid-fit
 * fix, not a redesign. Dropped: each problem card's mono "detail" footer
 * line (e.g. "96879917 -> Alex Rivera") - only one of our six problems has
 * a verified short example value to put there, and showing it on one card
 * but not the other five would look like an inconsistency rather than a
 * design choice, so the detail slot is omitted for all six instead of
 * invented for the other five.
 */
import { Icon, HubSpotMark, type IconName } from "./icons"

const PROBLEMS: { icon: IconName; title: string; desc: React.ReactNode }[] = [
  {
    icon: "broken",
    title: "Multi-row records",
    desc: "One contact with line breaks in Notes becomes four rows in HubSpot's own CSV export. VLOOKUPs break. Pivots are useless.",
  },
  {
    icon: "hash",
    title: "Owner IDs, not names",
    desc: (<>Owner columns show <code>96879917</code>, not a name - useless without a lookup table.</>),
  },
  {
    icon: "calendar",
    title: "Dates stored as text",
    desc: "Columns that look like dates aren't sortable or filterable, because Excel treats them as plain strings.",
  },
  {
    icon: "repeat",
    title: "No scheduling",
    desc: "Every week, someone exports the file by hand. Every week, they forget, or send the wrong one.",
  },
  {
    icon: "layers",
    title: "IDs silently rounded",
    desc: "Excel keeps 15 significant digits. A long record ID stored as a number is rounded into a different ID.",
  },
  {
    icon: "columns",
    title: "Arbitrary column order",
    desc: "HubSpot decides which columns go where. Every export is a scavenger hunt.",
  },
]

export function ProblemSection() {
  return (
    <section id="the-problem" className="section problem-section" aria-labelledby="problem-heading">
      <div className="container">
        <div className="section-heading centered">
          <span className="eyebrow">The problem</span>
          <h2 id="problem-heading">HubSpot&apos;s native export is broken</h2>
          <p>
            HubSpot&apos;s own product team has confirmed dashboard-to-Excel export is not on the roadmap. Here&apos;s
            what you&apos;re stuck with.
          </p>
        </div>
        <div className="problem-grid problem-grid--3col">
          {PROBLEMS.map((problem, i) => (
            <article key={problem.title} className="problem-card reveal-card">
              <div className="problem-card-top">
                <span className="problem-icon">
                  <Icon name={problem.icon} size={23} />
                </span>
                <span className="card-index">0{i + 1}</span>
              </div>
              <h3>{problem.title}</h3>
              <p>{problem.desc}</p>
            </article>
          ))}
        </div>
        <div className="problem-banner">
          The HubSpot Reporting add-on that fixes some of this: <strong>$200/month</strong> vs.{" "}
          <strong className="problem-banner-accent">$29/month</strong> with CleanExporter
        </div>
      </div>
    </section>
  )
}

const STEPS: { title: string; desc: string; icon: IconName }[] = [
  {
    icon: "external",
    title: "Connect HubSpot",
    desc: "One OAuth click. Read-only access - we can never write to your CRM. Revoke it from HubSpot at any time.",
  },
  {
    icon: "sliders",
    title: "Pick your object & properties",
    desc: "Contacts, Companies, Deals, or Tickets. Drag your columns into the exact order you want. Add filters if you need them.",
  },
  {
    icon: "calendar",
    title: "Set your schedule",
    desc: "Daily, weekly, or monthly - or run it manually whenever you want. CleanExporter emails you the file automatically.",
  },
  {
    icon: "mail",
    title: "Open your inbox",
    desc: "Your file arrives on time, every time. One row per record. Real dates. Owner names. No surprises.",
  },
]

export function Workflow() {
  return (
    <section id="how-it-works" className="section workflow-section" aria-labelledby="workflow-heading">
      <div className="container">
        <div className="section-heading centered">
          <span className="eyebrow">How it works</span>
          <h2 id="workflow-heading">Set it up in about 5 minutes</h2>
          <p>No code, no data team, no BI connector - just a clean file in your inbox.</p>
        </div>
        <ol className="workflow-steps">
          {STEPS.map((step, i) => (
            <li key={step.title} className="workflow-step reveal-card">
              <div className="workflow-step-top">
                <span className="step-number">0{i + 1}</span>
                <span className="step-icon">{i === 0 ? <HubSpotMark size={23} /> : <Icon name={step.icon} size={22} />}</span>
              </div>
              <h3>{step.title}</h3>
              <p>{step.desc}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  )
}
