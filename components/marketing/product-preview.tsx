/**
 * Ported from the reference's product-preview.tsx near-verbatim - its
 * logic (tab/keyboard handling, property toggling) is unchanged, and its
 * sample rows/company names are kept as the labeled "Interactive product
 * preview · Sample data" they already were: placeholder demo content, not
 * a marketing claim, so there's nothing here that needed sourcing from our
 * copy. What does map to real product facts was double-checked rather
 * than invented: the four CRM objects (Deals/Contacts/Companies/Tickets)
 * and the three schedule cadences (daily/weekly/monthly) match our actual
 * how-it-works copy exactly, and "Every Monday · 07:00" already lines up
 * with the hero's "Every Monday" headline. The Wordmark import needs no
 * text change - our product name is CleanExporter too (see icons.tsx). No
 * time-dependent computation: all state is useState, no Date.now()/setInterval.
 */
"use client"

import { useState, type KeyboardEvent } from "react"
import { ExcelMark, HubSpotMark, Icon, LogoMark, Wordmark, type IconName } from "./icons"

type ObjectKey = "Deals" | "Contacts" | "Companies" | "Tickets"
type PreviewTab = "configuration" | "preview"
type ScheduleKey = "weekly" | "daily" | "monthly"

interface SampleExport {
  title: string
  file: string
  icon: IconName
  properties: string[]
  filter: [string, string]
  rows: Record<string, string>[]
}

const samples: Record<ObjectKey, SampleExport> = {
  Deals: {
    title: "Weekly Pipeline", file: "weekly_pipeline.xlsx", icon: "deals",
    properties: ["Deal name", "Company", "Amount", "Deal owner", "Close date", "Deal stage"],
    filter: ["Pipeline", "Enterprise"],
    rows: [
      { "Deal name": "Acme · Enterprise", Company: "Acme Inc.", Amount: "$24,000", "Deal owner": "Alex Rivera", "Close date": "01/10/2026", "Deal stage": "Qualified" },
      { "Deal name": "Northstar · Growth", Company: "Northstar", Amount: "$18,500", "Deal owner": "Jamie Chen", "Close date": "08/10/2026", "Deal stage": "Proposal" },
      { "Deal name": "Meridian · Renewal", Company: "Meridian", Amount: "$32,000", "Deal owner": "Alex Rivera", "Close date": "12/10/2026", "Deal stage": "Negotiation" },
    ],
  },
  Contacts: {
    title: "Weekly Contacts", file: "weekly_contacts.xlsx", icon: "users",
    properties: ["First name", "Last name", "Email", "Company", "Contact owner", "Created date"],
    filter: ["Lifecycle stage", "Customer"],
    rows: [
      { "First name": "Taylor", "Last name": "Morgan", Email: "taylor@example.com", Company: "Acme Inc.", "Contact owner": "Alex Rivera", "Created date": "01/10/2026" },
      { "First name": "Jordan", "Last name": "Lee", Email: "jordan@example.com", Company: "Northstar", "Contact owner": "Jamie Chen", "Created date": "08/10/2026" },
      { "First name": "Sam", "Last name": "Patel", Email: "sam@example.com", Company: "Meridian", "Contact owner": "Alex Rivera", "Created date": "12/10/2026" },
    ],
  },
  Companies: {
    title: "Weekly Companies", file: "weekly_companies.xlsx", icon: "building",
    properties: ["Company name", "Domain", "Industry", "Company owner", "City", "Created date"],
    filter: ["Lifecycle stage", "Customer"],
    rows: [
      { "Company name": "Acme Inc.", Domain: "acme.example", Industry: "Software", "Company owner": "Alex Rivera", City: "London", "Created date": "01/10/2026" },
      { "Company name": "Northstar", Domain: "northstar.example", Industry: "Consulting", "Company owner": "Jamie Chen", City: "Paris", "Created date": "08/10/2026" },
      { "Company name": "Meridian", Domain: "meridian.example", Industry: "Technology", "Company owner": "Alex Rivera", City: "Berlin", "Created date": "12/10/2026" },
    ],
  },
  Tickets: {
    title: "Weekly Support", file: "weekly_support.xlsx", icon: "ticket",
    properties: ["Ticket name", "Status", "Priority", "Ticket owner", "Created date", "Company"],
    filter: ["Ticket status", "Open"],
    rows: [
      { "Ticket name": "Account setup", Status: "Open", Priority: "Medium", "Ticket owner": "Alex Rivera", "Created date": "01/10/2026", Company: "Acme Inc." },
      { "Ticket name": "Billing question", Status: "Open", Priority: "Low", "Ticket owner": "Jamie Chen", "Created date": "08/10/2026", Company: "Northstar" },
      { "Ticket name": "Access request", Status: "Open", Priority: "High", "Ticket owner": "Alex Rivera", "Created date": "12/10/2026", Company: "Meridian" },
    ],
  },
}

const schedules: Record<ScheduleKey, string> = {
  weekly: "Every Monday · 07:00",
  daily: "Every day · 07:00",
  monthly: "1st of the month · 07:00",
}

function SampleSheet({ sample, properties, compact = false }: { sample: SampleExport; properties: string[]; compact?: boolean }) {
  const columns = properties.slice(0, 3)
  if (!columns.length) return <div className="empty-sample">Select a property to preview your file.</div>
  return <table className={`sample-sheet${compact ? " sample-sheet--compact" : ""}`} aria-label="Example export using fictional sample data">
    <thead><tr>{columns.map((column) => <th key={column} scope="col">{column}</th>)}</tr></thead>
    <tbody>{sample.rows.slice(0, compact ? 2 : 3).map((row, index) => <tr key={index}>{columns.map((column) => <td key={column} title={row[column]}>{row[column]}</td>)}</tr>)}</tbody>
  </table>
}

export function ProductPreview() {
  const [object, setObject] = useState<ObjectKey>("Deals")
  const [tab, setTab] = useState<PreviewTab>("configuration")
  const [schedule, setSchedule] = useState<ScheduleKey>("weekly")
  const [properties, setProperties] = useState<string[]>(samples.Deals.properties)
  const sample = samples[object]

  function selectObject(value: ObjectKey) {
    setObject(value)
    setProperties(samples[value].properties)
  }

  function toggleProperty(property: string) {
    setProperties((current) => current.includes(property)
      ? current.filter((item) => item !== property)
      : sample.properties.filter((item) => item === property || current.includes(item)))
  }

  function onTabKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return
    event.preventDefault()
    const next: PreviewTab = event.key === "Home" ? "configuration" : event.key === "End" ? "preview" : tab === "configuration" ? "preview" : "configuration"
    setTab(next)
    document.getElementById(`demo-tab-${next}`)?.focus()
  }

  return <div className="product-preview" aria-label="Interactive CleanExporter product demonstration with fictional sample data">
    <div className="product-stage">
      <div className="preview-eyebrow"><span className="tiny-dot" /> YOUR NEXT MONDAY, SORTED.</div>
      <div className="product-window">
        <div className="app-header"><Wordmark compact /><span className="connection-status"><span />HubSpot connected</span></div>
        <div className="app-body">
          <aside className="app-sidebar" aria-label="Sample application sidebar">
            <div className="app-sidebar-label">WORKSPACE</div>
            <span><Icon name="grid" size={14} /> Overview</span>
            <span className="app-nav-active"><Icon name="file" size={14} /> Exports <span className="sidebar-count">3</span></span>
            <span><Icon name="calendar" size={14} /> Schedules</span>
            <div className="sidebar-bottom"><span className="sample-avatar">AR</span><div>Alex&rsquo;s team<small>Sample workspace</small></div></div>
          </aside>
          <div className="app-main">
            <div className="app-breadcrumb">Exports <Icon name="chevron-right" size={10} /> <span>{sample.title}</span></div>
            <div className="export-title-row"><h2>{sample.title}</h2><span className="scheduled-badge"><span />Scheduled</span></div>
            <p className="export-subtitle">Saved once. Delivered on your schedule.</p>
            <div className="app-tabs" role="tablist" aria-label="Product preview">
              {(["configuration", "preview"] as const).map((value) => <button key={value} id={`demo-tab-${value}`} type="button" role="tab" aria-selected={tab === value} aria-controls={`demo-panel-${value}`} tabIndex={tab === value ? 0 : -1} onClick={() => setTab(value)} onKeyDown={onTabKeyDown}>{value === "configuration" ? "Configuration" : "Data preview"}{value === "preview" && <span>3</span>}</button>)}
            </div>
            <div id="demo-panel-configuration" role="tabpanel" aria-labelledby="demo-tab-configuration" hidden={tab !== "configuration"}>
              <div className="demo-fields">
                <div><label htmlFor="demo-object">CRM OBJECT</label><div className="demo-select"><Icon name={sample.icon} size={14} /><select id="demo-object" value={object} onChange={(event) => selectObject(event.target.value as ObjectKey)}>{Object.keys(samples).map((key) => <option key={key}>{key}</option>)}</select><Icon name="chevron-down" size={12} /></div></div>
                <div><label htmlFor="demo-schedule">SCHEDULE</label><div className="demo-select"><Icon name="calendar" size={14} /><select id="demo-schedule" value={schedule} onChange={(event) => setSchedule(event.target.value as ScheduleKey)}>{Object.entries(schedules).map(([key, value]) => <option value={key} key={key}>{value}</option>)}</select><Icon name="chevron-down" size={12} /></div></div>
              </div>
              <fieldset className="demo-properties"><legend>PROPERTIES <span>{properties.length} selected</span></legend><div>{sample.properties.map((property) => <label key={property}><Icon name="grip" size={10} /><input type="checkbox" checked={properties.includes(property)} onChange={() => toggleProperty(property)} /><span className="demo-checkbox" aria-hidden="true"><Icon name="check" size={10} /></span><span>{property}</span></label>)}</div></fieldset>
              <div className="demo-filter"><span className="demo-label">FILTERS</span><div><Icon name="filter" size={12} /><span>{sample.filter[0]}</span><span className="filter-operator">is</span><span className="filter-value">{sample.filter[1]}</span></div></div>
            </div>
            <div id="demo-panel-preview" className="demo-data-panel" role="tabpanel" aria-labelledby="demo-tab-preview" hidden={tab !== "preview"}>
              <div className="demo-preview-info"><ExcelMark size={23} /><div><strong>{sample.file}</strong><span>{properties.length} columns · 3 sample records</span></div></div>
              <div className="demo-sheet-letters"><span />{properties.slice(0, 3).map((property, index) => <span key={property}>{String.fromCharCode(65 + index)}</span>)}</div>
              <SampleSheet sample={sample} properties={properties} />
              <p className="demo-preview-caption"><Icon name="check" size={12} />Readable names. Clean dates. Your column order.</p>
            </div>
            <div className="app-main-footer"><span><Icon name="clock" size={11} />{schedules[schedule]}</span><button type="button" onClick={() => setTab(tab === "preview" ? "configuration" : "preview")} disabled={properties.length === 0}>{tab === "preview" ? "Edit columns" : "Preview export"}<Icon name="arrow-right" size={11} /></button></div>
          </div>
        </div>
      </div>
      <div className="export-result">
        <div className="export-result-header"><ExcelMark size={26} /><div><strong>{sample.file}</strong><span>Clean. Structured. Ready to use.</span></div><span className="result-check"><Icon name="check" size={13} /></span></div>
        <SampleSheet sample={sample} properties={properties} compact />
      </div>
    </div>
    <div className="product-flow" aria-label="HubSpot to CleanExporter to an Excel XLSX file">
      <span className="flow-node"><span className="hubspot-color"><HubSpotMark size={20} /></span><strong>HubSpot</strong></span>
      <span className="flow-link"><Icon name="arrow-right" size={12} /></span>
      <span className="flow-node"><LogoMark size={22} /><strong>CleanExporter</strong></span>
      <span className="flow-link"><Icon name="arrow-right" size={12} /></span>
      <span className="flow-node"><ExcelMark size={22} /><strong>Excel <span className="flow-extension">.xlsx</span></strong></span>
    </div>
    <p className="product-demo-note">Interactive product preview <span>·</span> Sample data</p>
    <span className="sr-only" role="status">{object} export. {properties.length} properties selected. {schedules[schedule]}.</span>
  </div>
}
