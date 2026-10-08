import { marketingStructuredData } from "@/lib/seo";

export function MarketingStructuredData() {
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{
        __html: JSON.stringify(marketingStructuredData).replace(/</g, "\\u003c"),
      }}
    />
  );
}
