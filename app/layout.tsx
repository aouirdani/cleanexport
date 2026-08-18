import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";

// next/font self-hosts these at build time (no runtime request to
// fonts.googleapis.com, unlike the design reference's `@import url(...)`) -
// same visual identity, without adding an external stylesheet fetch.
// Variable names match app/globals.css's `--font-sans`/`--font-mono` theme
// keys directly, so there is exactly one place (globals.css) that decides
// what "sans" and "mono" mean.
const inter = Inter({
  variable: "--font-sans",
  subsets: ["latin"],
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "CleanExport — your HubSpot data, in a correct Excel file",
  description:
    "Scheduled, correct Excel exports of your HubSpot CRM data. No broken CSVs, no manual cleanup, on a schedule.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${inter.variable} ${jetbrainsMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
