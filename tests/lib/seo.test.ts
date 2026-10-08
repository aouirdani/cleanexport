import { describe, expect, it } from "vitest";
import { createPublicMetadata, publicSeoPages, resolveSeoSiteUrl, seoSiteUrl } from "@/lib/seo";

describe("SEO site URL", () => {
  it.each([
    "",
    "http://localhost:3000",
    "http://127.0.0.1:3100",
    "http://[::1]:3000",
  ])("keeps the verified production domain for local/CI config %s", (appUrl) => {
    expect(resolveSeoSiteUrl(appUrl).href).toBe("https://cleanexporter.com/");
  });

  it("uses an existing public APP_URL rather than silently switching its domain", () => {
    expect(resolveSeoSiteUrl("https://www.cleanexporter.com").origin)
      .toBe("https://www.cleanexporter.com");
  });

  it("does not copy paths, tracking parameters or fragments into the site origin", () => {
    expect(resolveSeoSiteUrl("https://cleanexporter.com/dashboard?utm_source=email#top").href)
      .toBe("https://cleanexporter.com/");
  });
});

describe("public page metadata", () => {
  it.each(publicSeoPages)("gives $path its own clean canonical and social metadata", (page) => {
    const metadata = createPublicMetadata(page);
    const canonical = `${seoSiteUrl.origin}${page.path}`;

    expect(metadata.alternates?.canonical).toBe(canonical);
    expect(metadata.openGraph).toMatchObject({
      title: metadata.title,
      description: metadata.description,
      url: canonical,
      siteName: "CleanExporter",
    });
    expect(metadata.twitter).toMatchObject({
      card: "summary",
      title: metadata.title,
      description: metadata.description,
    });
    expect(new URL(canonical).search).toBe("");
    expect(new URL(canonical).hash).toBe("");
  });

  it("uses distinct titles and descriptions for the four public search intents", () => {
    expect(new Set(publicSeoPages.map((page) => page.title)).size).toBe(4);
    expect(new Set(publicSeoPages.map((page) => page.description)).size).toBe(4);
  });
});
