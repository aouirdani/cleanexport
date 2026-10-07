/**
 * Ported as-is from
 * ~/dev/design-ref/build-cleanexporter-landing-page/src/components/marketing/icons.tsx.
 * Self-contained inline SVGs with no dependency on lucide-react, so the
 * marketing page's icon set matches the reference pixel-for-pixel. No text
 * change needed: our product name is CleanExporter too, so Wordmark's label
 * matches the reference verbatim. LogoMark's accent colors (hero
 * #FAFAF9/accent #F27550) are also unchanged - already generic hex, not the
 * dashboard's indigo.
 */
import type { CSSProperties, ReactNode } from "react"

export type IconName =
  | "arrow-right" | "arrow-down" | "arrow-up-right" | "check" | "chevron-down"
  | "chevron-right" | "play" | "shield" | "file" | "calendar" | "clock"
  | "users" | "building" | "deals" | "ticket" | "sliders" | "filter" | "link"
  | "mail" | "columns" | "repeat" | "broken" | "hash" | "layers" | "menu"
  | "close" | "plus" | "grid" | "grip" | "lock" | "briefcase" | "chart"
  | "wallet" | "globe" | "external" | "minus"

const paths: Record<IconName, ReactNode> = {
  "arrow-right": <><path d="M4 12h15M13 6l6 6-6 6" /></>,
  "arrow-down": <><path d="M12 4v15M6 13l6 6 6-6" /></>,
  "arrow-up-right": <><path d="M6 18 18 6M6 6h12v12" /></>,
  check: <path d="m5 12 4 4L19 6" />,
  "chevron-down": <path d="m7 10 5 5 5-5" />,
  "chevron-right": <path d="m10 7 5 5-5 5" />,
  play: <><circle cx="12" cy="12" r="9" /><path d="m10 8 6 4-6 4V8Z" /></>,
  shield: <><path d="m12 3 8 3v6c0 4-8 9-8 9s-8-5-8-9V6l8-3Z" /><path d="m8.5 12 2.5 2.5 4.5-5" /></>,
  file: <><path d="M13 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V10l-7-7Z" /><path d="M13 3v7h7M8 14h8M8 17h5" /></>,
  calendar: <><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M7 3v4M17 3v4M3 10h18M8 14h2M14 14h2M8 17h2" /></>,
  clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
  users: <><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" /><circle cx="9" cy="7" r="4" /></>,
  building: <><rect x="5" y="3" width="14" height="18" rx="1" /><path d="M9 7h1M14 7h1M9 11h1M14 11h1M9 15h1M14 15h1M10 21v-3h4v3" /></>,
  deals: <><path d="m3 7 5-4h10l3 4v13H3V7ZM3 7h18M8 3v4M16 3v4" /><path d="M9 12h6M12 10v7" /></>,
  ticket: <><path d="M21 8V5H3v3a4 4 0 0 1 0 8v3h18v-3a4 4 0 0 1 0-8Z" /><path d="M15 6v2M15 11v2M15 16v2" /></>,
  sliders: <><path d="M4 6h8M16 6h4M4 12h3M11 12h9M4 18h10M18 18h2" /><circle cx="14" cy="6" r="2" /><circle cx="9" cy="12" r="2" /><circle cx="16" cy="18" r="2" /></>,
  filter: <path d="M3 4h18l-7 8v7l-4 2v-9L3 4Z" />,
  link: <><path d="m10 13 4-4M9 16l-1 1a4 4 0 0 1-6-6l4-4a4 4 0 0 1 6 0M15 8l1-1a4 4 0 0 1 6 6l-4 4a4 4 0 0 1-6 0" /></>,
  mail: <><rect x="3" y="5" width="18" height="14" rx="2" /><path d="m3 7 9 6 9-6" /></>,
  columns: <><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M9 4v16M15 4v16" /></>,
  repeat: <><path d="m17 2 4 4-4 4M3 11V9a3 3 0 0 1 3-3h15M7 22l-4-4 4-4M21 13v2a3 3 0 0 1-3 3H3" /></>,
  broken: <><path d="M4 4h16v6l-4 2 4 2v6H4v-6l4-2-4-2V4ZM9 8h6M9 16h6" /></>,
  hash: <><path d="m10 3-3 18M17 3l-3 18M4 9h17M3 15h17" /></>,
  layers: <><path d="m12 3 10 5-10 5L2 8l10-5ZM2 12l10 5 10-5M2 16l10 5 10-5" /></>,
  menu: <><path d="M4 7h16M4 12h16M4 17h16" /></>,
  close: <path d="m6 6 12 12M6 18 18 6" />,
  plus: <path d="M12 5v14M5 12h14" />,
  grid: <><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" /></>,
  grip: <><circle cx="9" cy="5" r=".8" /><circle cx="15" cy="5" r=".8" /><circle cx="9" cy="12" r=".8" /><circle cx="15" cy="12" r=".8" /><circle cx="9" cy="19" r=".8" /><circle cx="15" cy="19" r=".8" /></>,
  lock: <><rect x="5" y="10" width="14" height="11" rx="2" /><path d="M8 10V7a4 4 0 0 1 8 0v3M12 14v3" /></>,
  briefcase: <><rect x="3" y="7" width="18" height="14" rx="2" /><path d="M8 7V3h8v4M3 12a22 22 0 0 0 18 0M10 13h4" /></>,
  chart: <><path d="M4 3v17h17M8 15l4-5 4 2 5-7" /></>,
  wallet: <><path d="M20 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h13a2 2 0 0 0 2-2v-3M3 7h15a2 2 0 0 1 2 2v7h-7V9h7M16 12h.01" /></>,
  globe: <><circle cx="12" cy="12" r="9" /><ellipse cx="12" cy="12" rx="4" ry="9" /><path d="M3 12h18" /></>,
  external: <><path d="M14 3h7v7M10 14 21 3M10 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-5" /></>,
  minus: <path d="M5 12h14" />,
}

export function Icon({ name, size = 20, className, style }: {
  name: IconName
  size?: number
  className?: string
  style?: CSSProperties
}) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={className} style={style}>{paths[name]}</svg>
}

/**
 * The mark's raw path data - the single source of truth, also consumed by
 * app/icon.tsx (the browser-tab favicon) so the two can never drift apart.
 * That favicon route can't import a React component (it returns a raw SVG
 * string, not JSX), so this is exported as plain data rather than leaving
 * the paths only inside LogoMark's JSX below.
 */
export const LOGO_MARK_PATHS = {
  document: "M9 8h8l4 4v12H9V8Z",
  fold: "M17 8v5h5",
  arrow: "M13 16h12m-4-4 4 4-4 4",
  /** The 1.5px detail stroke - legible at the header's 24-32px. Dropped in
   *  app/icon.tsx: at actual favicon display size (browsers commonly render
   *  tab icons at 16px) a 1.5-unit stroke in grey #747b77 on a near-white
   *  fill is below what anti-aliasing preserves - verified by rendering the
   *  full mark at 16px next to the same mark with this path removed. */
  detail: "M12 21h4",
} as const

export function LogoMark({ size = 32, className, detail = true }: { size?: number; className?: string; detail?: boolean }) {
  return <svg width={size} height={size} viewBox="0 0 32 32" fill="none" aria-hidden="true" className={className}>
    <rect x="1" y="1" width="30" height="30" rx="7" fill="currentColor" />
    <path d={LOGO_MARK_PATHS.document} fill="#FAFAF9" />
    <path d={LOGO_MARK_PATHS.fold} fill="#d5d6d2" />
    <path d={LOGO_MARK_PATHS.arrow} stroke="#F27550" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    {detail && <path d={LOGO_MARK_PATHS.detail} stroke="#747b77" strokeWidth="1.5" strokeLinecap="round" />}
  </svg>
}

export function Wordmark({ compact = false }: { compact?: boolean }) {
  return <span className={`wordmark${compact ? " wordmark--compact" : ""}`}><LogoMark size={compact ? 24 : 32} /><span>CleanExporter</span></span>
}

export function HubSpotMark({ size = 23 }: { size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 28 28" fill="none" aria-hidden="true">
    <path d="m8 8 9 7M18 14V7M17 17l-5 5" stroke="currentColor" strokeWidth="2.5" />
    <circle cx="6" cy="6" r="3" fill="currentColor" /><circle cx="18" cy="5" r="2.5" fill="currentColor" /><circle cx="10" cy="23" r="2.5" fill="currentColor" /><circle cx="18" cy="16" r="5" stroke="currentColor" strokeWidth="3" />
  </svg>
}

export function ExcelMark({ size = 27 }: { size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 30 32" fill="none" aria-hidden="true">
    <path d="M9 3h14l5 5v21H9V3Z" fill="#e1f1e8" /><path d="M23 3v6h5" fill="#b6d9c6" />
    <path d="M13 14h11M13 18h11M13 22h11M18 12v13" stroke="#76aa8d" strokeWidth="1" />
    <rect x="1" y="10" width="15" height="15" rx="2" fill="#25754b" /><path d="m5 14 6 7m0-7-6 7" stroke="white" strokeWidth="1.7" strokeLinecap="round" />
  </svg>
}
