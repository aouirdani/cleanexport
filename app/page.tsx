/**
 * The landing page - specs/07-TASKS.md T21, restructured to follow
 * ~/dev/design-ref/modernize-saas-landing-page/src/App.tsx for SECTION
 * ORDER/STRUCTURE only (sticky nav, reassurance strip, six-item "the
 * problem" grid, four-step "how it works", feature grid, closing CTA).
 * Two things deliberately NOT adopted from that reference: its emerald
 * accent (ours is the indigo used across the rest of the app - a green
 * landing page in front of an indigo dashboard would be worse than either
 * choice alone) and its mock Dashboard.tsx (ours is real). Our own
 * before/after comparison tables and "Honest limits" section are kept
 * as-is - already accurate, and the thing our competitors don't have.
 *
 * Every number on this page is a verified fact, not a reference
 * placeholder: plan caps from lib/plan.ts's PLAN_LIMITS, trial/pricing from
 * lib/stripe.ts, HubSpot/Enterprise pricing from public list prices. No
 * "HubSpot-certified" (we're not, and we're not on the Marketplace), no
 * "unlimited" anything, no "no credit card required" (lib/billing.ts's
 * createCheckoutSession does not set `payment_method_collection:
 * 'if_required'`, so Stripe Checkout collects a card by default), no
 * invented BI-connector/manual-export price tags.
 *
 * A server component, no 'use client': the only per-visitor thing this page
 * does is read the session cookie to decide which CTA to show, and that's
 * a single `readSession()` call (cookie decrypt only, no DB query) - not
 * `getCurrentSession()` from lib/currentPortal.ts, which additionally joins
 * Portal/User/Subscription and would cost three DB round trips this page
 * has no use for. "It must be fast: this is the page a cold email lands
 * on" - the lightest check that satisfies the requirement.
 */
import Link from "next/link"
import Image from "next/image"
import { readSession } from "@/lib/session"
import { Button } from "@/components/ui/button"
import {
  ArrowRight,
  Shield,
  Zap,
  Clock,
  Mail,
  ExternalLink,
  Columns3,
  CalendarClock,
  CheckCircle2,
} from "lucide-react"

export const dynamic = "force-dynamic"

const NAV_LINKS = [
  { label: "How it works", href: "#how-it-works" },
  { label: "Features", href: "#features" },
  { label: "Pricing", href: "#pricing" },
  { label: "FAQ", href: "#faq" },
] as const

// Reassurance strip, directly under the hero - adopted from the reference.
const REASSURANCES = [
  { icon: Shield, label: "Read-only access", sub: "We never write to your CRM" },
  { icon: Zap, label: "5-minute setup", sub: "No code, no config" },
  { icon: Clock, label: "14-day free trial", sub: "Full features from day one" },
  { icon: Mail, label: "Direct support", sub: "From the person who built it" },
] as const

// "The problem" - six real defects found probing the HubSpot API directly
// (recon/FINDINGS.md), not generic marketing complaints.
const PROBLEMS = [
  {
    title: "Multi-row records",
    desc: "One contact with line breaks in Notes becomes four rows in HubSpot's own CSV export. VLOOKUPs break. Pivots are useless.",
  },
  {
    title: "Owner IDs, not names",
    desc: <>Owner columns show <code className="rounded bg-muted px-1 py-0.5 font-mono text-[0.9em]">96879917</code>, not a name - useless without a lookup table.</>,
  },
  {
    title: "Dates stored as text",
    desc: "Columns that look like dates aren't sortable or filterable, because Excel treats them as plain strings.",
  },
  {
    title: "No scheduling",
    desc: "Every week, someone exports the file by hand. Every week, they forget, or send the wrong one.",
  },
  {
    title: "IDs silently rounded",
    desc: "Excel keeps 15 significant digits. A long record ID stored as a number is rounded into a different ID.",
  },
  {
    title: "Arbitrary column order",
    desc: "HubSpot decides which columns go where. Every export is a scavenger hunt.",
  },
] as const

const HOW_IT_WORKS = [
  {
    icon: ExternalLink,
    title: "Connect HubSpot",
    desc: "One OAuth click. Read-only access - we can never write to your CRM. Revoke it from HubSpot at any time.",
  },
  {
    icon: Columns3,
    title: "Pick your object & properties",
    desc: "Contacts, Companies, Deals, or Tickets. Drag your columns into the exact order you want. Add filters if you need them.",
  },
  {
    icon: CalendarClock,
    title: "Set your schedule",
    desc: "Daily, weekly, or monthly - or run it manually whenever you want. CleanExport emails you the file automatically.",
  },
  {
    icon: Mail,
    title: "Open your inbox",
    desc: "Your file arrives on time, every time. One row per record. Real dates. Owner names. No surprises.",
  },
] as const

const FEATURES = [
  { title: "One row per record", desc: "Line breaks in Notes or multi-line fields stay inside the cell - never split across rows." },
  { title: "Real Excel dates", desc: "Date fields are real date values - sortable, filterable, usable in formulas." },
  { title: "Owner names, not IDs", desc: "Owner columns show a name, not an 8-digit numeric ID you have to decode." },
  { title: "IDs kept as text", desc: "Record IDs are stored as text so Excel can't silently round them into a different ID." },
  { title: "Your column order", desc: "Drag properties into any order. CleanExport never rearranges them behind your back." },
  { title: "Flexible headers", desc: "Human labels, internal property names, or both rows at the top of the file." },
  { title: "Scheduled delivery", desc: "Daily, weekly, or monthly. Your file arrives without you lifting a finger." },
  { title: "Filters & associated columns", desc: "Export only the records you need, and pull in an associated company or contact's columns too." },
] as const

const HONEST_LIMITS = [
  "We can't import an existing HubSpot dashboard report — no API exposes that data. You rebuild the export once here, and then it runs forever.",
  "Excel output only for now. CSV and JSON are coming.",
  "One portal per account today. Agency multi-portal is next.",
]

const PLAN_INCLUDES = [
  "Contacts, Companies, Deals & Tickets",
  "Up to 10 export definitions, 5 of them scheduled",
  "Custom column order",
  "Filters & associated columns",
  "Flexible header styles",
  "Email delivery (daily / weekly / monthly)",
  "Run history & logs",
] as const

const COMPARE_ROWS = [
  { name: "HubSpot Reporting add-on", price: "$200/mo", note: "Still no scheduled export" },
  { name: "Professional → Enterprise upgrade", price: "$890 → $3,600/mo", note: "Way overkill just for exports" },
  { name: "A full BI connector", price: "Priced for a data team", note: "Needs someone to run it" },
  { name: "CleanExport", price: "$29/mo", note: "Does exactly what you need", highlight: true },
] as const

const FAQ = [
  {
    q: "Do you store my CRM data?",
    a: "No. Rows live in the generated file and nowhere else. We store your export settings and run history — never the records themselves.",
  },
  {
    q: "What access do you need?",
    a: "Read-only. We request no write scope on contacts, companies, or deals. You can revoke access from HubSpot at any time.",
  },
  {
    q: "Will this work on Starter?",
    a: "Yes for the objects your plan exposes. The value is highest on Professional, where reporting limits bite hardest.",
  },
  {
    q: "Who built this?",
    a: "Aymane Ouirdani. Contact me directly at aymane.ouirdani94@outlook.fr — you'll get a reply from the person who writes the code.",
  },
] as const

function ConnectCta({
  signedIn,
  label,
  className,
  size,
}: {
  signedIn: boolean
  label: string
  className?: string
  size?: "default" | "sm" | "lg"
}) {
  if (signedIn) {
    return (
      <Button size={size} className={className} render={<Link href="/dashboard" />} nativeButton={false}>
        Go to dashboard
      </Button>
    )
  }
  return (
    <Button size={size} className={className} render={<a href="/api/auth/hubspot/start" />} nativeButton={false}>
      {label}
      <ArrowRight aria-hidden />
    </Button>
  )
}

export default async function LandingPage() {
  const session = await readSession()
  const signedIn = session !== null

  return (
    <div className="flex flex-1 flex-col bg-background text-foreground">
      {/* Sticky nav with section anchors - adopted from the reference. */}
      <header className="sticky top-0 z-40 border-b border-border bg-background/95 backdrop-blur-sm supports-backdrop-filter:bg-background/80">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
          <Image src="/logo.png" alt="CleanExport" width={78} height={28} priority />
          <nav className="hidden items-center gap-1 text-[13px] md:flex">
            {NAV_LINKS.map((link) => (
              <a
                key={link.href}
                href={link.href}
                className="rounded-md px-2.5 py-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                {link.label}
              </a>
            ))}
          </nav>
          <div className="flex items-center gap-3">
            {signedIn && (
              <Link href="/dashboard" className="hidden text-sm text-muted-foreground hover:text-foreground sm:inline">
                Go to dashboard
              </Link>
            )}
            {!signedIn && <ConnectCta signedIn={false} label="Start free trial" size="sm" />}
          </div>
        </div>
      </header>

      <main className="flex flex-col">
        {/* 1. Hero */}
        <section className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-6 py-20 sm:py-28">
          <h1 className="text-3xl font-semibold tracking-tight text-balance sm:text-4xl">
            Your HubSpot data. In a correct Excel file. Every Monday.
          </h1>
          <p className="max-w-xl text-lg leading-8 text-muted-foreground">
            HubSpot won&apos;t export a dashboard report to Excel. Its CSV export splits one contact into four rows
            when a Notes field contains line breaks. Column order isn&apos;t preserved. And you can&apos;t schedule
            any of it.
          </p>
          <p className="max-w-xl text-lg leading-8 font-semibold">
            CleanExport does one thing: your report, as a clean{" "}
            <code className="rounded bg-muted px-1 py-0.5 font-mono text-[0.85em] font-normal">.xlsx</code>, on a
            schedule.
          </p>
          <div className="flex flex-col items-start gap-2">
            <ConnectCta signedIn={signedIn} label="Connect HubSpot" className="h-11 px-6 text-base" size="lg" />
          </div>
        </section>

        {/* 2. Our before/after comparison tables - kept exactly as built, not the reference's placeholder screenshots. */}
        <section className="border-t border-border bg-muted/30">
          <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-6 py-16">
            <div className="grid gap-4 sm:grid-cols-2">
              <figure className="flex flex-col gap-2">
                <div className="overflow-x-auto rounded-lg border border-border bg-background">
                  <table className="w-full min-w-max text-left text-xs">
                    <thead>
                      <tr className="border-b border-border bg-muted/50">
                        <th className="px-2.5 py-2 font-medium">Name</th>
                        <th className="px-2.5 py-2 font-medium">Notes</th>
                        <th className="px-2.5 py-2 font-medium text-left">Date created</th>
                        <th className="px-2.5 py-2 font-medium">Owner</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr className="border-b border-border/60">
                        <td className="px-2.5 py-1.5 align-top">Jordan Lee</td>
                        <td className="px-2.5 py-1.5 align-top">Interested in Enterprise plan.</td>
                        <td className="px-2.5 py-1.5 align-top text-left">3/1/2024</td>
                        <td className="px-2.5 py-1.5 align-top font-mono">96879917</td>
                      </tr>
                      <tr className="border-b border-border/60">
                        <td className="px-2.5 py-1.5 align-top"></td>
                        <td className="px-2.5 py-1.5 align-top">Follow up after Q3 renewal.</td>
                        <td className="px-2.5 py-1.5 align-top"></td>
                        <td className="px-2.5 py-1.5 align-top"></td>
                      </tr>
                      <tr className="border-b border-border/60">
                        <td className="px-2.5 py-1.5 align-top"></td>
                        <td className="px-2.5 py-1.5 align-top">Wants pricing for 50 seats.</td>
                        <td className="px-2.5 py-1.5 align-top"></td>
                        <td className="px-2.5 py-1.5 align-top"></td>
                      </tr>
                      <tr className="last:border-0">
                        <td className="px-2.5 py-1.5 align-top"></td>
                        <td className="px-2.5 py-1.5 align-top">Loop in the CS team before renewal.</td>
                        <td className="px-2.5 py-1.5 align-top"></td>
                        <td className="px-2.5 py-1.5 align-top"></td>
                      </tr>
                    </tbody>
                  </table>
                </div>
                <figcaption className="text-sm">
                  <span className="font-semibold">Left — HubSpot&apos;s CSV export.</span>{" "}
                  <span className="text-muted-foreground">
                    One contact. Four rows. The Notes field broke the record apart.
                  </span>
                </figcaption>
              </figure>
              <figure className="flex flex-col gap-2">
                <div className="overflow-x-auto rounded-lg border border-primary/30 bg-background">
                  <table className="w-full min-w-max text-left text-xs">
                    <thead>
                      <tr className="border-b border-border bg-muted/50">
                        <th className="px-2.5 py-2 align-bottom font-medium">
                          <div>Name</div>
                          <div className="text-[9px] font-normal tracking-wider text-muted-foreground uppercase">text</div>
                        </th>
                        <th className="px-2.5 py-2 align-bottom font-medium">
                          <div>Notes</div>
                          <div className="text-[9px] font-normal tracking-wider text-muted-foreground uppercase">text</div>
                        </th>
                        <th className="px-2.5 py-2 align-bottom font-medium text-right">
                          <div>Date created</div>
                          <div className="text-[9px] font-normal tracking-wider text-muted-foreground uppercase">date</div>
                        </th>
                        <th className="px-2.5 py-2 align-bottom font-medium">
                          <div>Owner</div>
                          <div className="text-[9px] font-normal tracking-wider text-muted-foreground uppercase">text</div>
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr>
                        <td className="px-2.5 py-1.5 align-top">Jordan Lee</td>
                        <td className="px-2.5 py-1.5 align-top whitespace-pre-wrap">
                          {"Interested in Enterprise plan.\nFollow up after Q3 renewal.\nWants pricing for 50 seats.\nLoop in the CS team before renewal."}
                        </td>
                        <td className="px-2.5 py-1.5 align-top text-right font-mono tabular-nums">2024-03-01</td>
                        <td className="px-2.5 py-1.5 align-top">Alex Rivera</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
                <figcaption className="text-sm">
                  <span className="font-semibold">Right — CleanExport.</span>{" "}
                  <span className="text-muted-foreground">
                    The same contact. One row. Line breaks preserved inside the cell.
                  </span>
                </figcaption>
              </figure>
            </div>
            <blockquote className="text-center text-base font-medium text-muted-foreground">
              This is the whole product. A file that is correct.
            </blockquote>
          </div>
        </section>

        {/* 3. Reassurance strip - adopted from the reference. */}
        <section className="border-t border-border">
          <div className="mx-auto grid w-full max-w-5xl grid-cols-2 gap-8 px-6 py-14 text-center sm:grid-cols-4">
            {REASSURANCES.map(({ icon: Icon, label, sub }) => (
              <div key={label} className="flex flex-col items-center gap-2">
                <div className="grid size-11 place-items-center rounded-xl border border-border bg-muted/40">
                  <Icon className="size-5 text-muted-foreground" aria-hidden strokeWidth={1.75} />
                </div>
                <p className="text-[13px] font-medium">{label}</p>
                <p className="text-xs text-muted-foreground">{sub}</p>
              </div>
            ))}
          </div>
        </section>

        {/* 4. The problem - six real defects, each traced to a probed HubSpot API behaviour. */}
        <section id="the-problem" className="border-t border-border bg-muted/30">
          <div className="mx-auto flex w-full max-w-5xl flex-col gap-10 px-6 py-16">
            <div className="mx-auto max-w-xl text-center">
              <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">The problem</p>
              <h2 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">HubSpot&apos;s native export is broken</h2>
              <p className="mt-3 text-muted-foreground">
                HubSpot&apos;s own product team has confirmed dashboard-to-Excel export is not on the roadmap. Here&apos;s
                what you&apos;re stuck with.
              </p>
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {PROBLEMS.map((problem) => (
                <div key={problem.title} className="rounded-xl border border-border bg-card p-5">
                  <h3 className="text-[13px] font-medium">{problem.title}</h3>
                  <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{problem.desc}</p>
                </div>
              ))}
            </div>
            <div className="mx-auto flex flex-wrap items-center justify-center gap-3 rounded-xl border border-border bg-card px-6 py-4 text-sm">
              <span className="text-muted-foreground">The HubSpot Reporting add-on that fixes some of this:</span>
              <span className="font-semibold">$200/month</span>
              <span className="text-muted-foreground">vs.</span>
              <span className="font-semibold text-primary">$29/month</span>
              <span className="text-muted-foreground">with CleanExport</span>
            </div>
          </div>
        </section>

        {/* 5. How it works - four numbered steps. */}
        <section id="how-it-works" className="border-t border-border">
          <div className="mx-auto flex w-full max-w-5xl flex-col gap-10 px-6 py-16">
            <div className="mx-auto max-w-xl text-center">
              <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">How it works</p>
              <h2 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">Set it up in about 5 minutes</h2>
              <p className="mt-3 text-muted-foreground">No code, no data team, no BI connector - just a clean file in your inbox.</p>
            </div>
            <div className="grid grid-cols-1 gap-8 sm:grid-cols-2 lg:grid-cols-4">
              {HOW_IT_WORKS.map((step, i) => (
                <div key={step.title} className="flex flex-col items-center text-center">
                  <div className="relative grid size-14 place-items-center rounded-2xl border border-border bg-muted/40">
                    <step.icon className="size-5 text-muted-foreground" aria-hidden strokeWidth={1.75} />
                    <span className="absolute -top-2 -right-2 grid size-5 place-items-center rounded-full bg-primary text-[10px] font-semibold text-primary-foreground">
                      {i + 1}
                    </span>
                  </div>
                  <h3 className="mt-4 text-[13px] font-medium">{step.title}</h3>
                  <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{step.desc}</p>
                </div>
              ))}
            </div>
            <div className="mx-auto">
              <ConnectCta signedIn={signedIn} label="Get started" className="h-11 px-6 text-base" size="lg" />
            </div>
          </div>
        </section>

        {/* 6. Features grid. */}
        <section id="features" className="border-t border-border bg-muted/30">
          <div className="mx-auto flex w-full max-w-5xl flex-col gap-10 px-6 py-16">
            <div className="mx-auto max-w-xl text-center">
              <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Features</p>
              <h2 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">Everything your export should be</h2>
              <p className="mt-3 text-muted-foreground">CleanExport does one thing and does it right: a file that is correct.</p>
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {FEATURES.map((feature) => (
                <div key={feature.title} className="flex gap-3 rounded-xl border border-border bg-card p-5">
                  <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
                  <div>
                    <h3 className="text-[13px] font-medium">{feature.title}</h3>
                    <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{feature.desc}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* 7. Honest limits - kept as-is. The reference drops this; we don't. */}
        <section className="border-t border-border">
          <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-6 py-16">
            <div>
              <h2 className="text-xl font-semibold tracking-tight">Honest limits</h2>
              <p className="mt-1 text-muted-foreground">Say these out loud. They cost you nothing and they buy trust.</p>
            </div>
            <ul className="flex flex-col gap-3">
              {HONEST_LIMITS.map((limit) => (
                <li key={limit} className="flex gap-2.5 text-base leading-7">
                  <span className="text-muted-foreground" aria-hidden>
                    —
                  </span>
                  <span>{limit}</span>
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* 8. Pricing - real numbers only. */}
        <section id="pricing" className="border-t border-border bg-muted/30">
          <div className="mx-auto flex w-full max-w-5xl flex-col gap-10 px-6 py-16">
            <div className="mx-auto max-w-xl text-center">
              <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Pricing</p>
              <h2 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">One plan. Simple pricing.</h2>
              <p className="mt-3 text-muted-foreground">No hidden tiers. No per-seat fees. Just one flat rate.</p>
            </div>

            <div className="mx-auto grid w-full max-w-4xl grid-cols-1 items-stretch gap-6 md:grid-cols-2">
              <div className="flex flex-col rounded-2xl border border-border bg-card p-8">
                <h3 className="text-lg font-semibold">CleanExport</h3>
                <p className="mt-1 text-sm text-muted-foreground">Everything you need to export HubSpot data correctly.</p>

                <p className="mt-6 text-lg leading-8">
                  <strong className="text-4xl font-semibold tracking-tight">$29</strong>
                  <span className="text-muted-foreground">/month</span>
                  <span className="text-muted-foreground"> — or </span>
                  <strong className="font-semibold">$290/year</strong>
                  <span className="text-muted-foreground">, two months free</span>
                </p>
                <p className="mt-1 text-xs text-muted-foreground">14-day free trial. Cancel in one click.</p>

                <ul className="mt-6 flex flex-1 flex-col gap-2.5">
                  {PLAN_INCLUDES.map((item) => (
                    <li key={item} className="flex items-start gap-2.5 text-sm">
                      <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
                      {item}
                    </li>
                  ))}
                </ul>

                <ConnectCta signedIn={signedIn} label="Start free trial" className="mt-8 h-11 px-6 text-base" size="lg" />
              </div>

              <div className="flex flex-col rounded-2xl border border-border bg-card p-8">
                <h3 className="text-lg font-semibold">How does it compare?</h3>
                <p className="mt-1 text-sm text-muted-foreground">
                  The alternatives cost a lot more - or don&apos;t solve the problem at all.
                </p>

                <div className="mt-6 flex flex-1 flex-col gap-3">
                  {COMPARE_ROWS.map((row) => {
                    const highlight = "highlight" in row && row.highlight
                    return (
                      <div
                        key={row.name}
                        className={`flex items-center justify-between gap-4 rounded-lg border px-4 py-3 text-sm ${
                          highlight ? "border-primary/30 bg-primary/5" : "border-border"
                        }`}
                      >
                        <div className="min-w-0">
                          <p className={highlight ? "font-medium text-primary" : "font-medium"}>{row.name}</p>
                          <p className="text-xs text-muted-foreground">{row.note}</p>
                        </div>
                        <span className={`shrink-0 font-semibold ${highlight ? "text-primary" : ""}`}>{row.price}</span>
                      </div>
                    )
                  })}
                </div>

                <p className="mt-6 text-xs text-muted-foreground">
                  You&apos;re already paying for HubSpot. You shouldn&apos;t have to pay a fifth of that again just to
                  get your own data out.
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* 9. FAQ */}
        <section id="faq" className="border-t border-border">
          <div className="mx-auto flex w-full max-w-3xl flex-col gap-8 px-6 py-16">
            <h2 className="text-xl font-semibold tracking-tight">FAQ</h2>
            <dl className="flex flex-col gap-6">
              {FAQ.map(({ q, a }) => (
                <div key={q}>
                  <dt className="font-semibold">{q}</dt>
                  <dd className="mt-1 text-muted-foreground">{a}</dd>
                </div>
              ))}
            </dl>
          </div>
        </section>

        {/* 10. Closing CTA - adopted from the reference, indigo instead of emerald, no invented star rating. */}
        <section className="border-t border-border bg-foreground text-background">
          <div className="mx-auto flex max-w-3xl flex-col items-center gap-4 px-6 py-20 text-center">
            <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">Stop fighting with broken exports.</h2>
            <p className="max-w-xl text-base leading-relaxed text-background/70">
              Connect HubSpot and set up your first export in about 5 minutes.
            </p>
            <ConnectCta signedIn={signedIn} label="Connect HubSpot" className="mt-2 h-11 px-6 text-base" size="lg" />
            <p className="text-xs text-background/60">14-day free trial · Cancel anytime · $29/month after</p>
          </div>
        </section>
      </main>

      {/* Footer */}
      <footer className="border-t border-border">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-6 px-6 py-10 text-sm sm:flex-row">
          <Image src="/logo.png" alt="CleanExport" width={68} height={24} />
          <nav className="flex items-center gap-6">
            {NAV_LINKS.map((link) => (
              <a key={link.href} href={link.href} className="text-muted-foreground hover:text-foreground">
                {link.label}
              </a>
            ))}
            <a href="mailto:aymane.ouirdani94@outlook.fr" className="text-muted-foreground hover:text-foreground">
              Support
            </a>
          </nav>
          <p className="text-xs text-muted-foreground">
            © {new Date().getFullYear()} CleanExport · Built by Aymane Ouirdani
          </p>
        </div>
      </footer>
    </div>
  )
}
