/**
 * The browser-tab favicon - the same mark components/marketing/icons.tsx's
 * LogoMark renders in the header, built from the exact same path data
 * (LOGO_MARK_PATHS) so the two can't drift apart. Replaces the old
 * app/icon.png (a mismatched grid+arrow design left over from before the
 * current mark existed).
 *
 * A plain SVG string via Response, not next/og's ImageResponse: the mark
 * is already vector art with no layout to compute, so there's nothing for
 * Satori to do that a template string doesn't do more simply - and SVG
 * output stays crisp at every size a browser tab renders it at, where a
 * rasterized ImageResponse PNG would not.
 *
 * The 1.5px detail stroke LogoMark draws at the bottom of the document is
 * dropped here (detail={false} equivalent, hand-omitted since this isn't
 * JSX) - confirmed by rendering the mark at 16-32px that it's not
 * perceptible at favicon size, so it's cut rather than left in as noise.
 * The background is an explicit #252b27 rather than currentColor (there is
 * no surrounding text-color context for a favicon).
 */
import { LOGO_MARK_PATHS } from "@/components/marketing/icons"

export const size = { width: 32, height: 32 }
export const contentType = "image/svg+xml"

export default function Icon() {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32" fill="none"><rect x="1" y="1" width="30" height="30" rx="7" fill="#252b27"/><path d="${LOGO_MARK_PATHS.document}" fill="#FAFAF9"/><path d="${LOGO_MARK_PATHS.fold}" fill="#d5d6d2"/><path d="${LOGO_MARK_PATHS.arrow}" stroke="#F27550" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`

  return new Response(svg, {
    headers: { "Content-Type": contentType },
  })
}
