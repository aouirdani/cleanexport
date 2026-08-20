/**
 * The landing page - specs/07-TASKS.md T21. Copy is verbatim from
 * docs/LANDING-COPY.md (the "Outreach plan" section at the bottom of that
 * file is founder guidance, not page content, and is not rendered here).
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

export const dynamic = "force-dynamic"

const PRICE_ROWS = [
  { option: "HubSpot Reporting add-on", price: "$200/month", priceStrong: true },
  { option: "Upgrade Professional → Enterprise", price: "$890 → $3,600/month" },
  { option: "A full BI connector", price: "Priced for a data team, not for exports" },
  { option: "CleanExport", price: "$29/month", rowStrong: true },
] as const

const WHAT_IT_DOES = [
  "Pick an object — contacts, companies, deals, tickets",
  <>Pick your properties, <strong className="font-semibold text-foreground">drag them into the order you want</strong></>,
  "Optional filters, optional associated company or contact columns",
  "Choose your header style: human labels, internal names, or both",
  "Get the file by email, daily, weekly or monthly",
]

const CORRECTNESS_GUARANTEES = [
  <>
    <strong className="font-semibold text-foreground">Line breaks stay inside the cell.</strong> One record is
    always one row. Always.
  </>,
  <>
    <strong className="font-semibold text-foreground">Dates are real Excel dates.</strong> Sortable, filterable,
    not text that looks like a date.
  </>,
  <>
    <strong className="font-semibold text-foreground">Owner columns show names</strong>, not{" "}
    <code className="rounded bg-muted px-1 py-0.5 font-mono text-[0.9em]">96879917</code>.
  </>,
  <>
    <strong className="font-semibold text-foreground">Record IDs stay as text.</strong> Excel keeps 15 significant
    digits — a long ID stored as a number is silently rounded into a <em>different</em> ID. We never let that
    happen.
  </>,
  <>
    <strong className="font-semibold text-foreground">Column order is yours.</strong> We never sort it.
  </>,
  <>
    <strong className="font-semibold text-foreground">Headers you can automate against.</strong> Choose internal
    property names, or get both rows.
  </>,
]

const HONEST_LIMITS = [
  "We can't import an existing HubSpot dashboard report — no API exposes that data. You rebuild the export once here, and then it runs forever.",
  "Excel output only for now. CSV and JSON are coming.",
  "One portal per account today. Agency multi-portal is next.",
]

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
    a: "Aymane Ouirdani. Contact me directly at support@cleanexport.com — you'll get a reply from the person who writes the code.",
  },
] as const

function ConnectCta({
  signedIn,
  label,
  className,
}: {
  signedIn: boolean
  label: string
  className?: string
}) {
  if (signedIn) {
    return (
      <Button className={className} render={<Link href="/dashboard" />} nativeButton={false}>
        Go to dashboard
      </Button>
    )
  }
  return (
    <Button className={className} render={<a href="/api/auth/hubspot/start" />} nativeButton={false}>
      {label}
    </Button>
  )
}

export default async function LandingPage() {
  const session = await readSession()
  const signedIn = session !== null

  return (
    <div className="flex flex-1 flex-col bg-background text-foreground">
      <header className="border-b border-border">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-6 py-4">
          <Image src="/logo.png" alt="CleanExport" width={78} height={28} priority />
          {signedIn && (
            <Link href="/dashboard" className="text-sm text-muted-foreground hover:text-foreground">
              Go to dashboard
            </Link>
          )}
        </div>
      </header>

      <main className="flex flex-col">
        {/* 1. Above the fold */}
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
            <ConnectCta signedIn={signedIn} label="Connect HubSpot — 14 days free" className="h-11 px-6 text-base" />
            <p className="text-sm text-muted-foreground italic">Read-only access. We never write to your CRM.</p>
          </div>
        </section>

        {/* 2. The proof section */}
        <section className="border-t border-border bg-muted/30">
          <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-6 py-16">
            <div className="grid gap-4 sm:grid-cols-2">
              <figure className="flex flex-col gap-2">
                <div className="flex aspect-video items-center justify-center rounded-lg border border-dashed border-border bg-background text-center text-sm text-muted-foreground">
                  Screenshot placeholder — HubSpot&apos;s CSV export
                </div>
                <figcaption className="text-sm">
                  <span className="font-semibold">Left — HubSpot&apos;s CSV export.</span>{" "}
                  <span className="text-muted-foreground">
                    One contact. Four rows. The Notes field broke the record apart.
                  </span>
                </figcaption>
              </figure>
              <figure className="flex flex-col gap-2">
                <div className="flex aspect-video items-center justify-center rounded-lg border border-dashed border-border bg-background text-center text-sm text-muted-foreground">
                  Screenshot placeholder — CleanExport
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

        {/* 3. Why this exists / price comparison */}
        <section className="border-t border-border">
          <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-6 py-16">
            <p className="text-lg leading-8">
              HubSpot&apos;s own product team has said dashboard-to-Excel export is not on the roadmap.
            </p>
            <p className="text-muted-foreground">Meanwhile the workarounds cost real money:</p>
            <div className="overflow-x-auto rounded-lg border border-border">
              <table className="w-full min-w-max text-left text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/50">
                    <th className="px-4 py-2.5 font-medium">Option</th>
                    <th className="px-4 py-2.5 font-medium">Price</th>
                  </tr>
                </thead>
                <tbody>
                  {PRICE_ROWS.map((row) => (
                    <tr key={row.option} className="border-b border-border/60 last:border-0">
                      <td className={`px-4 py-2.5 ${"rowStrong" in row && row.rowStrong ? "font-semibold" : ""}`}>
                        {row.option}
                      </td>
                      <td
                        className={`px-4 py-2.5 ${
                          ("rowStrong" in row && row.rowStrong) || ("priceStrong" in row && row.priceStrong)
                            ? "font-semibold"
                            : ""
                        }`}
                      >
                        {row.price}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-lg leading-8">
              You&apos;re already paying for HubSpot. You shouldn&apos;t have to pay a fifth of that again to get
              your own data out of it.
            </p>
          </div>
        </section>

        {/* 4. What it does */}
        <section className="border-t border-border bg-muted/30">
          <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-6 py-16">
            <h2 className="text-xl font-semibold tracking-tight">What it does</h2>
            <ul className="flex flex-col gap-2.5">
              {WHAT_IT_DOES.map((item, i) => (
                <li key={i} className="flex gap-2.5 text-base leading-7">
                  <span className="text-muted-foreground" aria-hidden>
                    —
                  </span>
                  <span>{item}</span>
                </li>
              ))}
            </ul>
            <p className="text-muted-foreground">
              That&apos;s it. It doesn&apos;t visualise, blend sources, or write back to HubSpot.
            </p>
          </div>
        </section>

        {/* 5. What makes the file correct */}
        <section className="border-t border-border">
          <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-6 py-16">
            <div>
              <h2 className="text-xl font-semibold tracking-tight">What makes the file correct</h2>
              <p className="mt-1 text-muted-foreground">
                Plain answers to the things that break in every other export:
              </p>
            </div>
            <div className="grid gap-x-8 gap-y-5 sm:grid-cols-2">
              {CORRECTNESS_GUARANTEES.map((item, i) => (
                <p key={i} className="text-base leading-7">
                  {item}
                </p>
              ))}
            </div>
          </div>
        </section>

        {/* 6. Honest limits */}
        <section className="border-t border-border bg-muted/30">
          <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-6 py-16">
            <div>
              <h2 className="text-xl font-semibold tracking-tight">Honest limits</h2>
              <p className="mt-1 text-muted-foreground">
                Say these out loud. They cost you nothing and they buy trust.
              </p>
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

        {/* 7. Pricing */}
        <section className="border-t border-border">
          <div className="mx-auto flex w-full max-w-3xl flex-col items-start gap-4 px-6 py-16">
            <h2 className="text-xl font-semibold tracking-tight">Pricing</h2>
            <p className="text-lg leading-8">
              <strong className="font-semibold">$29/month</strong> — or{" "}
              <strong className="font-semibold">$290/year</strong>, two months free.
              <br />
              14-day trial. No card up front. Cancel in one click.
            </p>
            <p className="text-muted-foreground">Compare: the HubSpot Reporting add-on is $200/month.</p>
            <ConnectCta signedIn={signedIn} label="Connect HubSpot" className="h-11 px-6 text-base" />
          </div>
        </section>

        {/* 8. FAQ */}
        <section className="border-t border-border bg-muted/30">
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
      </main>
    </div>
  )
}
