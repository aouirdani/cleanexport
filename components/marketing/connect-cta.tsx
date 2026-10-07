/**
 * Not from the reference: the reference's CTAs are static links (it has no
 * concept of a logged-in visitor). Ours must send a signed-in visitor to
 * /dashboard instead of back through OAuth, so this wraps that branch in
 * one place. Renders the reference's exact .button/.button-primary markup.
 */
import Link from "next/link"
import { Icon } from "./icons"
import { siteConfig } from "./site-config"

export function ConnectCta({
  signedIn,
  label,
  className = "",
}: {
  signedIn: boolean
  label: string
  className?: string
}) {
  const classes = `button button-primary ${className}`.trim()

  if (signedIn) {
    return (
      <Link href="/dashboard" className={classes}>
        Go to dashboard
      </Link>
    )
  }
  return (
    <a href={siteConfig.signupUrl} className={classes}>
      {label}
      <Icon name="arrow-right" size={16} />
    </a>
  )
}
