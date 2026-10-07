/**
 * Adapted from the reference's site-config.ts: same shape, our real
 * destinations. signupUrl is relative (not an absolute cleanexport.app
 * URL) because it's the actual OAuth-start route this app serves today -
 * see app/api/auth/hubspot/start.
 */
export const siteConfig = {
  name: "CleanExporter",
  signupUrl: "/api/auth/hubspot/start",
  loginUrl: "/login",
  contactEmail: "aymane.ouirdani94@outlook.fr",
} as const

export const navigation = [
  { label: "How it works", href: "#how-it-works" },
  { label: "Features", href: "#features" },
  { label: "Pricing", href: "#pricing" },
  { label: "FAQ", href: "#faq" },
] as const

export const contactUrl = `mailto:${siteConfig.contactEmail}`
