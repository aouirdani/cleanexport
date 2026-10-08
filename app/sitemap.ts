import type { MetadataRoute } from "next";
import { publicSeoPages, seoSiteUrl } from "@/lib/seo";

export default function sitemap(): MetadataRoute.Sitemap {
  return publicSeoPages.map(({ path }) => ({
    url: new URL(path, seoSiteUrl).href,
  }));
}
