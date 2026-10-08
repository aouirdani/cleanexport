import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { readSessionMock } = vi.hoisted(() => ({ readSessionMock: vi.fn() }));
vi.mock("@/lib/session", () => ({ readSession: readSessionMock }));

import LandingPage from "@/app/page";
import MarketingLayout from "@/app/(marketing)/layout";
import HubSpotToExcelPage from "@/app/(marketing)/hubspot-to-excel/page";
import ScheduledHubSpotExportsPage from "@/app/(marketing)/scheduled-hubspot-exports/page";
import HubSpotExportGuidePage from "@/app/(marketing)/hubspot-export-guide/page";
import { SeoResources } from "@/components/marketing/seo-resources";
import { MarketingStructuredData } from "@/components/marketing/structured-data";
import { Pricing } from "@/components/marketing/pricing-faq";

beforeEach(() => {
  readSessionMock.mockReset();
  readSessionMock.mockResolvedValue(null);
});

describe("public SEO content", () => {
  it.each([
    {
      path: "/hubspot-to-excel",
      Page: HubSpotToExcelPage,
      heading: "Export HubSpot data to Excel, automatically",
      links: ["/hubspot-export-guide", "/scheduled-hubspot-exports", "/#pricing"],
    },
    {
      path: "/scheduled-hubspot-exports",
      Page: ScheduledHubSpotExportsPage,
      heading: "Schedule your HubSpot exports automatically",
      links: ["/hubspot-export-guide", "/hubspot-to-excel", "/#pricing"],
    },
    {
      path: "/hubspot-export-guide",
      Page: HubSpotExportGuidePage,
      heading: "How to export HubSpot data to Excel",
      links: ["/", "/hubspot-to-excel", "/scheduled-hubspot-exports"],
    },
  ])("renders the intended H1 and contextual links for $path", ({ Page, heading, links }) => {
    const html = renderToStaticMarkup(createElement(Page));
    expect(html.match(/<h1\b/g)).toHaveLength(1);
    expect(html).toContain(`<h1>${heading}</h1>`);
    for (const path of links) expect(html).toContain(`href="${path}"`);
  });

  it("links the homepage to all three new public pages", () => {
    const html = renderToStaticMarkup(createElement(SeoResources));
    for (const path of ["/hubspot-to-excel", "/scheduled-hubspot-exports", "/hubspot-export-guide"]) {
      expect(html).toContain(`href="${path}"`);
    }
  });

  it("renders only truthful Organization and SoftwareApplication data with visible pricing", () => {
    const html = renderToStaticMarkup(createElement(MarketingStructuredData));
    const payload = html.match(/<script[^>]*>([\s\S]*?)<\/script>/)?.[1];
    expect(payload).toBeDefined();
    const graph = JSON.parse(payload!)["@graph"];
    expect(graph.map((item: { "@type": string }) => item["@type"]))
      .toEqual(["Organization", "SoftwareApplication"]);
    expect(graph[0].name).toBe("CleanExporter");
    expect(graph[1].offers).toMatchObject({
      price: "29",
      priceCurrency: "USD",
      priceSpecification: { billingDuration: "P1M" },
    });
    expect(graph[1]).not.toHaveProperty("aggregateRating");
    expect(graph[1]).not.toHaveProperty("review");
    const pricingHtml = renderToStaticMarkup(createElement(Pricing, { signedIn: false }));
    expect(pricingHtml).toContain('$29');
    expect(pricingHtml).toContain('/month');
  });
});

describe("session-aware marketing CTAs", () => {
  it.each([false, true])("preserves homepage and new-page destinations when signedIn=%s", async (signedIn) => {
    readSessionMock.mockResolvedValue(signedIn ? {
      portalId: "portal-1",
      hubspotPortalId: "123",
      userId: "user-1",
      issuedAt: Date.now(),
    } : null);

    const homepage = renderToStaticMarkup(await LandingPage());
    const newPage = renderToStaticMarkup(await MarketingLayout({
      children: createElement(HubSpotToExcelPage),
    }));
    for (const html of [homepage, newPage]) {
      expect(html).toContain(signedIn ? 'href="/dashboard"' : 'href="/api/auth/hubspot/start"');
      if (signedIn) expect(html).not.toContain('href="/api/auth/hubspot/start"');
    }
    expect(homepage).toContain("One portal per account today.");
    expect(homepage).not.toContain("across every client portal");
    expect(homepage).not.toContain("Say these out loud");
    expect(homepage).not.toContain("They cost you nothing and they buy trust");
  });
});
