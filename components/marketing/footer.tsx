/**
 * Ported from the reference's footer.tsx (FinalCTA + Footer).
 * Drops, both because we have no sourced text for them (same reasoning as
 * hero.tsx's dropped hero-badge, not a new decision):
 *   - FinalCTA's short eyebrow tagline ("YOUR NEXT EXPORT CAN BE YOUR
 *     LAST MANUAL ONE.")
 *   - final-reassurance's "No credit card required" - also factually
 *     wrong for us (see pricing-faq.tsx's note on the same claim), so
 *     this is a correction as much as a drop.
 *   - Footer's Privacy/Terms mailto links - the source invented these
 *     because it has no legal pages either; we don't have the content (or
 *     the original page) to justify adding them now.
 * Kept: "Independent software. Not affiliated with HubSpot." - true,
 * costs nothing, and matches the reference's own legal-safety reasoning.
 *
 * The brand link got the same #top treatment as navbar.tsx's, for the same
 * reason and for consistency: a visitor who scrolled all the way down to
 * read the footer and then clicks the logo is reaching for "take me back
 * up," not "reload the page I'm already on" - the same click should not
 * behave differently here than it does in the header.
 */
import { Icon, Wordmark } from "./icons"
import { ConnectCta } from "./connect-cta"
import { navigation, contactUrl } from "./site-config"

export function FinalCTA({ signedIn }: { signedIn: boolean }) {
  return (
    <section className="final-cta-section" aria-labelledby="final-cta-heading">
      <div className="container">
        <div className="final-cta">
          <h2 id="final-cta-heading">Stop fighting with broken exports.</h2>
          <p>Connect HubSpot and set up your first export in about 5 minutes.</p>
          <ConnectCta signedIn={signedIn} label="Connect HubSpot" />
          <span className="final-reassurance">14-day free trial · Cancel anytime · $29/month after</span>
        </div>
      </div>
    </section>
  )
}

export function Footer() {
  return (
    <footer className="site-footer">
      <div className="container">
        <div className="footer-top">
          <div className="footer-brand">
            <a href="#top" aria-label="CleanExporter home">
              <Wordmark />
            </a>
            <p>
              Your HubSpot data,
              <br />
              in a correct Excel file.
            </p>
          </div>
          <nav className="footer-navigation" aria-label="Footer navigation">
            {navigation.map((item) => (
              <a key={item.href} href={item.href}>
                {item.label}
              </a>
            ))}
            <a href={contactUrl}>
              Contact <Icon name="arrow-up-right" size={13} />
            </a>
          </nav>
        </div>
        <div className="footer-bottom">
          <span>© {new Date().getFullYear()} CleanExporter · Built by Aymane Ouirdani</span>
          <span className="footer-disclaimer">Independent software. Not affiliated with HubSpot.</span>
        </div>
      </div>
    </footer>
  )
}
