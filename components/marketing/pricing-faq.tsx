/**
 * Ported from the reference's pricing-faq.tsx. PricingCard's monthly/
 * yearly billing toggle (useState only, no clock/date logic) is kept
 * as-is - our pricing is genuinely $29/mo or $290/yr (two months free),
 * so the source's interactive toggle fits real numbers exactly. One
 * deliberate correction: the source's pricing-card-reassurance says
 * "No credit card required" - false for us (Stripe Checkout here collects
 * a card by default; see lib/billing.ts), so that line is replaced with
 * our actual claim, "Read-only access," rather than ported verbatim.
 *
 * Pricing's copy column swaps the source's two generic value props for
 * our real four-row price comparison (COMPARE_ROWS), since that's the
 * actual verified content we have for this slot - a different shape, so
 * it uses .compare-row (added to landing.css) instead of .pricing-value.
 *
 * FAQ: our four verified questions replace the source's seven generic
 * ones outright (not merged - we don't have verified answers for the
 * source's extra questions, like "Do I need to install anything?").
 */
"use client"

import { useState } from "react"
import { Icon } from "./icons"
import { contactUrl } from "./site-config"
import { ConnectCta } from "./connect-cta"

const COMPARE_ROWS = [
  { name: "HubSpot Reporting add-on", price: "$200/mo", note: "Still no scheduled export" },
  { name: "Professional → Enterprise upgrade", price: "$890 → $3,600/mo", note: "Way overkill just for exports" },
  { name: "A full BI connector", price: "Priced for a data team", note: "Needs someone to run it" },
  { name: "CleanExporter", price: "$29/mo", note: "Does exactly what you need", highlight: true },
] as const

const PLAN_INCLUDES = [
  "Contacts, Companies, Deals & Tickets",
  "Up to 10 export definitions, 5 of them scheduled",
  "Custom column order",
  "Filters & associated columns",
  "Flexible header styles",
  "Email delivery (daily / weekly / monthly)",
  "Run history & logs",
] as const

function PricingCard({ signedIn }: { signedIn: boolean }) {
  const [annual, setAnnual] = useState(false)
  return (
    <div className="pricing-card">
      <div className="pricing-card-title">
        <h3>CleanExporter</h3>
        <span>14-day free trial</span>
      </div>
      <p className="pricing-card-description">Everything you need to export HubSpot data correctly.</p>
      <div className="billing-toggle" role="group" aria-label="View monthly or yearly pricing">
        <button type="button" aria-pressed={!annual} onClick={() => setAnnual(false)}>
          Monthly
        </button>
        <button type="button" aria-pressed={annual} onClick={() => setAnnual(true)}>
          Yearly <span>2 months free</span>
        </button>
      </div>
      <div className="pricing-amount" aria-live="polite" aria-atomic="true">
        <span className="price-value" key={annual ? "yearly" : "monthly"}>
          ${annual ? "290" : "29"}
        </span>
        <span className="price-period">/{annual ? "year" : "month"}</span>
        <p>{annual ? "About $24.17/month, billed annually." : "Billed monthly. Cancel in one click."}</p>
      </div>
      <div className="pricing-divider" />
      <span className="pricing-included-label">Everything you need</span>
      <ul className="pricing-inclusions">
        {PLAN_INCLUDES.map((item) => (
          <li key={item}>
            <Icon name="check" size={16} />
            {item}
          </li>
        ))}
      </ul>
      <ConnectCta signedIn={signedIn} label="Start your 14-day free trial" className="pricing-cta" />
      <p className="pricing-card-reassurance">
        <Icon name="shield" size={12} />
        Read-only access <span aria-hidden="true">·</span> Cancel anytime
      </p>
    </div>
  )
}

export function Pricing({ signedIn }: { signedIn: boolean }) {
  return (
    <section id="pricing" className="section pricing-section" aria-labelledby="pricing-heading">
      <div className="container pricing-layout">
        <div className="pricing-copy">
          <span className="eyebrow">Pricing</span>
          <h2 id="pricing-heading">One plan. Simple pricing.</h2>
          <p>No hidden tiers. No per-seat fees. Just one flat rate - and here&apos;s how it compares.</p>
          {COMPARE_ROWS.map((row) => (
            <div key={row.name} className={`compare-row ${"highlight" in row && row.highlight ? "compare-row--highlight" : ""}`}>
              <div>
                <p className="compare-row-name">{row.name}</p>
                <p className="compare-row-note">{row.note}</p>
              </div>
              <span className="compare-row-price">{row.price}</span>
            </div>
          ))}
          <p className="pricing-annual-note">
            You&apos;re already paying for HubSpot. <strong>You shouldn&apos;t have to pay a fifth of that again</strong>{" "}
            just to get your own data out of it.
          </p>
        </div>
        <PricingCard signedIn={signedIn} />
      </div>
    </section>
  )
}

const FAQS = [
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
    a: "Aymane Ouirdani. Contact me directly — you'll get a reply from the person who writes the code.",
  },
] as const

export function FAQ() {
  return (
    <section id="faq" className="section faq-section" aria-labelledby="faq-heading">
      <div className="container faq-layout">
        <div className="faq-copy">
          <span className="eyebrow">Questions</span>
          <h2 id="faq-heading">FAQ</h2>
          <div className="faq-contact">
            <span>Still have a question?</span>
            <a href={contactUrl}>
              Get in touch <Icon name="arrow-up-right" size={15} />
            </a>
          </div>
        </div>
        <div className="faq-list">
          {FAQS.map((faq, index) => (
            <details key={faq.q} className="faq-item" name="cleanexport-faq" open={index === 0}>
              <summary>
                {faq.q}
                <span className="faq-toggle">
                  <Icon name="plus" size={17} />
                </span>
              </summary>
              <div className="faq-answer">
                <p>{faq.a}</p>
              </div>
            </details>
          ))}
        </div>
      </div>
    </section>
  )
}
