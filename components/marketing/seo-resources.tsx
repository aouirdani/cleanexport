import Link from "next/link";
import { publicSeoPages } from "@/lib/seo";
import styles from "./seo.module.css";

export function SeoResources() {
  return (
    <section className="section" aria-labelledby="export-resources-heading">
      <div className="container">
        <div className="section-heading">
          <span className="eyebrow">Resources</span>
          <h2 id="export-resources-heading">Make your HubSpot exports work for you</h2>
          <p>Explore the product, plan a recurring export, or follow the setup guide.</p>
        </div>
        <nav className={styles.resourceGrid} aria-label="HubSpot export resources">
          {publicSeoPages.slice(1).map((page) => (
            <Link key={page.path} href={page.path} className={styles.resourceCard}>
              <h3>{page.label}</h3>
              <p>{page.description}</p>
              <span className={styles.resourceAction}>Read more →</span>
            </Link>
          ))}
        </nav>
      </div>
    </section>
  );
}
