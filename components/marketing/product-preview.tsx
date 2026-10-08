/**
 * Rebuilt from what app/(app)/dashboard/page.tsx and
 * components/dashboard/run-status-badge.tsx actually render, replacing
 * the reference's invented app chrome. Two concrete problems this fixes:
 *
 *   - The reference's left sidebar (Overview / Exports / Schedules) -
 *     our dashboard has no sidebar. Nav is two links in the header,
 *     "Dashboard" and "Run history" (app/(app)/layout.tsx), so that's
 *     what's here instead - spans, not links, since this sits inside a
 *     mockup of someone else's screen, not real site navigation.
 *
 *   - The reference's static green "Scheduled" pill, which matched no
 *     real status, and its Excel-grid data table (row numbers, A/B/C
 *     column letters) - neither has a counterpart on the real overview
 *     page, which is a plain list. Replaced with that list's actual
 *     fields: each export's name, object type + schedule text,
 *     recipients, and its latest run's real status badge - the same
 *     five states run-status-badge.tsx renders (SUCCESS/RUNNING/
 *     QUEUED/FAILED/CANCELLED), in the exact same colors: .run-badge's
 *     variants in landing.css reference var(--success)/var(--warning)/
 *     var(--info)/var(--danger) directly, the same tokens the dashboard
 *     itself uses, not a marketing-palette approximation of them.
 *
 * Sample data, explicitly labeled as such (same as before). No
 * interactivity left to fake: the real overview is a read-only list, not
 * a form, so this is a plain server-rendered component now rather than a
 * "use client" one - nothing here was time-dependent before either, and
 * there's nothing left that needs state.
 */
import { ExcelMark, HubSpotMark, Icon, LogoMark, Wordmark } from "./icons"

type RunStatus = "success" | "running" | "queued"

interface ExportRow {
  name: string
  objectType: string
  schedule: string
  recipients: string
  status: RunStatus
  statusLabel: string
  time: string
}

/** Wording and shape match app/(app)/dashboard/page.tsx exactly: object
 *  type label, then "·", then the schedule text describeSchedule() picks
 *  ("Scheduled (<tz>)" or "Manual only"), then the recipients line, then
 *  the latest run's RunStatusBadge + components/dashboard/format.ts's
 *  formatDateTime() (en-US, UTC, "MMM DD, YYYY, HH:MM AM/PM UTC"). */
const EXPORTS: ExportRow[] = [
  {
    name: "Weekly Pipeline",
    objectType: "Deals",
    schedule: "Scheduled (America/New_York)",
    recipients: "Sends to alex@acme.example",
    status: "success",
    statusLabel: "Success",
    time: "Oct 06, 2026, 07:02 AM UTC",
  },
  {
    name: "Weekly Contacts",
    objectType: "Contacts",
    schedule: "Scheduled (America/New_York)",
    recipients: "Sends to jamie@northstar.example",
    status: "running",
    statusLabel: "Running",
    time: "Oct 06, 2026, 07:00 AM UTC",
  },
  {
    name: "Monthly Companies",
    objectType: "Companies",
    schedule: "Manual only",
    recipients: "Sends to sam@meridian.example",
    status: "queued",
    statusLabel: "Queued",
    time: "Oct 06, 2026, 07:00 AM UTC",
  },
]

export function ProductPreview() {
  return (
    <div className="product-preview" aria-label="A sample view of the CleanExporter dashboard, with fictional export data">
      <div className="product-stage">
        <div className="preview-eyebrow">
          <span className="tiny-dot" /> YOUR NEXT MONDAY, SORTED.
        </div>
        <div className="product-window">
          <div className="app-header">
            <div className="app-header-left">
              <Wordmark compact />
              <nav className="app-nav" aria-label="Sample dashboard navigation">
                <span aria-current="page">Dashboard</span>
                <span>Run history</span>
              </nav>
            </div>
            <span className="connection-status">
              <span />
              HubSpot connected
            </span>
          </div>
          <div className="app-main">
            <div className="app-main-heading">
              <h2>Dashboard</h2>
              <p>{EXPORTS.length} exports configured.</p>
            </div>
            <ul className="export-list">
              {EXPORTS.map((item) => (
                <li key={item.name} className="export-row">
                  <div>
                    <p className="export-row-name">{item.name}</p>
                    <p className="export-row-meta">
                      {item.objectType}
                      <span aria-hidden>·</span>
                      {item.schedule}
                    </p>
                    <p className="export-row-recipients">{item.recipients}</p>
                  </div>
                  <div className="export-row-status">
                    <span className={`run-badge run-badge--${item.status}`}>
                      <span className="run-badge-dot" aria-hidden />
                      {item.statusLabel}
                    </span>
                    <span className="run-badge-time">{item.time}</span>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
      <div className="product-flow" aria-label="HubSpot to CleanExporter to an Excel XLSX file">
        <span className="flow-node">
          <span className="hubspot-color">
            <HubSpotMark size={20} />
          </span>
          <strong>HubSpot</strong>
        </span>
        <span className="flow-link">
          <Icon name="arrow-right" size={12} />
        </span>
        <span className="flow-node">
          <LogoMark size={22} />
          <strong>CleanExporter</strong>
        </span>
        <span className="flow-link">
          <Icon name="arrow-right" size={12} />
        </span>
        <span className="flow-node">
          <ExcelMark size={22} />
          <strong>
            Excel <span className="flow-extension">.xlsx</span>
          </strong>
        </span>
      </div>
      <p className="product-demo-note">
        Sample dashboard preview <span>·</span> Fictional data
      </p>
    </div>
  )
}
