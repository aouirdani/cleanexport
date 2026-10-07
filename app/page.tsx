/**
 * The landing page. This is now a close port of the reference project at
 * ~/dev/design-ref/build-cleanexporter-landing-page/src/ - its components,
 * landing.css and this file's own section order are all taken from there
 * (see each component file's header comment for exactly what was ported
 * vs. adapted vs. dropped). Styling choice: landing.css is imported once,
 * from app/globals.css, rather than hand-converted to Tailwind utilities -
 * it is a large, already-finished stylesheet, and re-authoring ~2500 lines
 * of utility classes would be pure transcription risk for no behavioural
 * gain. Every rule in it is scoped under .marketing-page (the source left
 * many rules bare, relying on being the only stylesheet in its project),
 * so none of it can leak into the dashboard's own tokens/classes, which
 * this task does not touch.
 *
 * Section order, matching the reference's own app/page.tsx exactly:
 *   Navbar -> Hero (+ProductPreview) -> TrustStrip -> ProblemSection ->
 *   Workflow -> DataComparison -> FeatureGrid -> UseCases -> HonestLimits
 *   -> Pricing -> FAQ -> FinalCTA -> Footer
 * HonestLimits (ours, no reference equivalent) sits where the reference's
 * `Comparison` component would have been - that component was dropped
 * (see features-usecases.tsx) for lack of verified content, and
 * HonestLimits is a natural fit for the same "last reassurance before
 * price" slot.
 *
 * A server component; the only session check is readSession() (cookie
 * decrypt, no DB query) - same as before this pass.
 */
import { readSession } from "@/lib/session"
import { Navbar } from "@/components/marketing/navbar"
import { Hero, TrustStrip } from "@/components/marketing/hero"
import { ProblemSection, Workflow } from "@/components/marketing/problem-workflow"
import { DataComparison } from "@/components/marketing/data-comparison"
import { FeatureGrid, UseCases } from "@/components/marketing/features-usecases"
import { HonestLimits } from "@/components/marketing/honest-limits"
import { Pricing, FAQ } from "@/components/marketing/pricing-faq"
import { FinalCTA, Footer } from "@/components/marketing/footer"

export const dynamic = "force-dynamic"

export default async function LandingPage() {
  const session = await readSession()
  const signedIn = session !== null

  return (
    <div id="top" className="marketing-page flex flex-1 flex-col">
      <a href="#main-content" className="skip-link">
        Skip to main content
      </a>
      <Navbar signedIn={signedIn} />
      <main id="main-content" className="flex flex-col">
        <Hero signedIn={signedIn} />
        <TrustStrip />
        <ProblemSection />
        <Workflow />
        <DataComparison />
        <FeatureGrid />
        <UseCases />
        <HonestLimits />
        <Pricing signedIn={signedIn} />
        <FAQ />
        <FinalCTA signedIn={signedIn} />
      </main>
      <Footer />
    </div>
  )
}
