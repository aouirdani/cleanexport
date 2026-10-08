import type { Metadata } from "next";
import { siteConfig } from "@/components/marketing/site-config";

// Confirmed in docs/PLAN.md and against the live domain. APP_URL remains
// the source for public deployments; local/CI URLs must not enter the sitemap.
const PRODUCTION_SITE_URL = "https://cleanexporter.com";

export function resolveSeoSiteUrl(appUrl = process.env.APP_URL): URL {
  const configuredUrl = new URL(appUrl || PRODUCTION_SITE_URL);
  const isLocal = ["localhost", "127.0.0.1", "[::1]"].includes(configuredUrl.hostname);
  return new URL(isLocal ? PRODUCTION_SITE_URL : configuredUrl.origin);
}

export const seoSiteUrl = resolveSeoSiteUrl();

// Explicit allowlist: login, dashboard and API routes are never sitemap entries.
export const publicSeoPages = [
  {
    path: "/",
    title: "HubSpot to Excel: Scheduled Exports | CleanExporter",
    description:
      "Export HubSpot contacts, companies, deals and tickets to clean Excel files. Schedule email delivery with real dates, owner names and custom column order.",
    label: "CleanExporter",
  },
  {
    path: "/hubspot-to-excel",
    title: "HubSpot to Excel: Export Data Automatically | CleanExporter",
    description:
      "Export HubSpot data to Excel with custom columns, filters and readable owner names. Automate delivery of clean XLSX files with CleanExporter.",
    label: "HubSpot to Excel",
  },
  {
    path: "/scheduled-hubspot-exports",
    title: "Scheduled HubSpot Exports to Excel | CleanExporter",
    description:
      "Schedule daily, weekly or monthly HubSpot exports to Excel. Choose a timezone and email recipients, then follow each run in CleanExporter.",
    label: "Scheduled HubSpot exports",
  },
  {
    path: "/hubspot-export-guide",
    title: "How to Export HubSpot Data to Excel | CleanExporter",
    description:
      "A practical HubSpot export guide: choose records and properties, order columns, check Excel data types and set up scheduled delivery with CleanExporter.",
    label: "HubSpot export guide",
  },
] as const;

export function createPublicMetadata(page: (typeof publicSeoPages)[number]): Metadata {
  const url = new URL(page.path, seoSiteUrl).href;

  return {
    title: page.title,
    description: page.description,
    alternates: { canonical: url },
    openGraph: {
      type: "website",
      locale: "en_US",
      siteName: siteConfig.name,
      title: page.title,
      description: page.description,
      url,
    },
    twitter: {
      card: "summary",
      title: page.title,
      description: page.description,
    },
  };
}

// Only rendered on the homepage, where the product, pricing and contact
// information are visible. No legal entity, ratings or customer count inferred.
export const marketingStructuredData = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Organization",
      "@id": new URL("/#organization", seoSiteUrl).href,
      name: siteConfig.name,
      url: seoSiteUrl.href,
      email: siteConfig.contactEmail,
    },
    {
      "@type": "SoftwareApplication",
      "@id": new URL("/#software", seoSiteUrl).href,
      name: siteConfig.name,
      url: seoSiteUrl.href,
      applicationCategory: "BusinessApplication",
      operatingSystem: "Web browser",
      description: publicSeoPages[0].description,
      publisher: { "@id": new URL("/#organization", seoSiteUrl).href },
      offers: {
        "@type": "Offer",
        url: new URL("/#pricing", seoSiteUrl).href,
        price: "29",
        priceCurrency: "USD",
        priceSpecification: {
          "@type": "UnitPriceSpecification",
          price: "29",
          priceCurrency: "USD",
          billingDuration: "P1M",
        },
      },
    },
  ],
};
