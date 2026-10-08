import type { ReactNode } from "react";
import Link from "next/link";
import { readSession } from "@/lib/session";
import { ConnectCta } from "@/components/marketing/connect-cta";
import { FinalCTA } from "@/components/marketing/footer";
import { Wordmark } from "@/components/marketing/icons";
import { SeoResources } from "@/components/marketing/seo-resources";
import { contactUrl } from "@/components/marketing/site-config";
import styles from "@/components/marketing/seo.module.css";

// New public pages use the existing session-aware CTA, just like the homepage.
export const dynamic = "force-dynamic";

export default async function MarketingLayout({ children }: { children: ReactNode }) {
  const signedIn = (await readSession()) !== null;

  return (
    <div id="top" className="marketing-page flex flex-1 flex-col">
      <a href="#main-content" className="skip-link">Skip to main content</a>
      <header className="site-header">
        <div className="container navbar">
          <Link href="/" className="brand-link" aria-label="CleanExporter home">
            <Wordmark compact />
          </Link>
          <nav className={styles.headerActions} aria-label="Product navigation">
            <Link href="/#pricing">Pricing</Link>
            <ConnectCta signedIn={signedIn} label="Connect HubSpot" className="navbar-cta" />
          </nav>
        </div>
      </header>
      <main id="main-content">
        <article className={styles.article}>
          <nav className={styles.breadcrumbs} aria-label="Breadcrumb">
            <Link href="/">CleanExporter home</Link>
          </nav>
          {children}
        </article>
        <SeoResources />
        <FinalCTA signedIn={signedIn} />
      </main>
      <footer className="site-footer">
        <div className="container">
          <nav className="footer-navigation" aria-label="Footer navigation">
            <Link href="/">CleanExporter</Link>
            <Link href="/#pricing">Pricing</Link>
            <a href={contactUrl}>Contact</a>
          </nav>
          <div className="footer-bottom">
            <span>CleanExporter · Built by Aymane Ouirdani</span>
            <span className="footer-disclaimer">Independent software. Not affiliated with HubSpot.</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
