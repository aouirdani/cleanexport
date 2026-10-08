import { describe, expect, it } from "vitest";
import robots from "@/app/robots";
import sitemap from "@/app/sitemap";
import { metadata as loginMetadata } from "@/app/login/page";
import { seoSiteUrl } from "@/lib/seo";

describe("crawl and indexing policy", () => {
  it("leaves login crawlable so its noindex directive can be read", () => {
    expect(loginMetadata.robots).toEqual({ index: false, follow: true });
    expect(loginMetadata.alternates?.canonical).toBeUndefined();
    expect(robots().rules).toEqual({ userAgent: "*", allow: "/" });
    expect(robots().sitemap).toBe(`${seoSiteUrl.origin}/sitemap.xml`);
  });

  it("lists exactly the four indexable public pages, excluding login and private/API routes", () => {
    const urls = sitemap().map(({ url }) => url);
    expect(urls).toEqual([
      `${seoSiteUrl.origin}/`,
      `${seoSiteUrl.origin}/hubspot-to-excel`,
      `${seoSiteUrl.origin}/scheduled-hubspot-exports`,
      `${seoSiteUrl.origin}/hubspot-export-guide`,
    ]);
    expect(new Set(urls).size).toBe(urls.length);
    expect(urls.every((url) => !new URL(url).search && !new URL(url).hash)).toBe(true);
  });
});
