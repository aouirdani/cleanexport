/**
 * Ported from the reference's hero.tsx (Hero + TrustStrip), copy replaced
 * with ours throughout. Two structural drops, both because we have no
 * verified source text for them (rather than inventing filler):
 *   - hero-badge ("Built for HubSpot teams") - no equivalent short badge
 *     phrase exists in our copy.
 *   - TrustStrip's four items are replaced with our REASSURANCES, which
 *     pair a label with a second reason line ("Read-only access" / "We
 *     never write to your CRM") - a content shape the source's single-line
 *     <li> didn't carry, so .trust-content li gained a nested <div> (see
 *     landing.css) to hold both without dropping the reason half.
 * Kept: the accent-colored span inside h1 (reference highlights one line;
 * here it highlights the "correct" promise, our actual differentiator).
 * supported-objects reuses our real, verified object list (Contacts,
 * Companies, Deals, Tickets - see how-it-works copy) instead of inventing
 * one.
 */
import { Icon, type IconName } from "./icons"
import { ProductPreview } from "./product-preview"
import { ConnectCta } from "./connect-cta"

const SUPPORTED_OBJECTS: { label: string; icon: IconName }[] = [
  { label: "Contacts", icon: "users" },
  { label: "Companies", icon: "building" },
  { label: "Deals", icon: "deals" },
  { label: "Tickets", icon: "ticket" },
]

export function Hero({ signedIn }: { signedIn: boolean }) {
  return (
    <section className="hero-section" aria-labelledby="hero-heading">
      <div className="container hero-grid">
        <div className="hero-copy">
          <h1 id="hero-heading">
            Your HubSpot data.
            <br />
            <span>In a correct Excel file.</span>
            <br />
            Every Monday.
          </h1>
          <p className="hero-description">
            HubSpot won&apos;t export a dashboard report to Excel. Its CSV export splits one contact into four rows
            when a Notes field contains line breaks. Column order isn&apos;t preserved. And you can&apos;t schedule
            any of it.
          </p>
          <p className="hero-description hero-description--strong">
            CleanExport does one thing: your report, as a clean <code>.xlsx</code>, on a schedule.
          </p>
          <div className="hero-actions">
            <ConnectCta signedIn={signedIn} label="Connect HubSpot" className="hero-cta" />
          </div>
          <p className="hero-reassurance">
            <Icon name="shield" size={13} />
            Read-only access<span aria-hidden="true">·</span>We never write to your CRM
          </p>
          <div className="supported-objects">
            <span className="supported-label">YOUR CRM, COVERED</span>
            <div>
              {SUPPORTED_OBJECTS.map(({ label, icon }) => (
                <span key={label}>
                  <Icon name={icon} size={14} />
                  {label}
                </span>
              ))}
            </div>
          </div>
        </div>
        <ProductPreview />
      </div>
    </section>
  )
}

const REASSURANCES: { icon: IconName; label: string; sub: string }[] = [
  { icon: "shield", label: "Read-only access", sub: "We never write to your CRM" },
  { icon: "clock", label: "5-minute setup", sub: "No code, no config" },
  { icon: "calendar", label: "14-day free trial", sub: "Full features from day one" },
  { icon: "mail", label: "Direct support", sub: "From the person who built it" },
]

export function TrustStrip() {
  return (
    <section className="trust-strip" aria-label="Why teams trust CleanExport">
      <div className="container trust-content">
        <ul>
          {REASSURANCES.map((item) => (
            <li key={item.label}>
              <Icon name={item.icon} size={19} />
              <div>
                <strong>{item.label}</strong>
                <span>{item.sub}</span>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </section>
  )
}
