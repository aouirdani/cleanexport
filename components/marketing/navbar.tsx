/**
 * Ported from the reference's navbar.tsx: scroll-detected sticky header
 * (data-scrolled) and the mobile menu toggle/escape-to-close behavior are
 * taken as-is. Adapted: the reference's static "Log in"/"Start free" pair
 * becomes signedIn-aware (a signed-in visitor sees a dashboard link, not
 * a second OAuth CTA) via ConnectCta, and nav links point at our own
 * section ids.
 *
 * The brand link is a plain `<a href="#top">`, not next/link's `<Link>`:
 * we're always already on this page when it's clicked (Navbar only
 * renders here), so a route transition was never the right tool - it just
 * made the logo trigger a full page reload instead of scrolling. #top
 * (the id on app/page.tsx's root div) scrolls there natively, inheriting
 * `scroll-behavior: smooth` and `scroll-padding-top: 96px` from
 * `html:has(.marketing-page)` in landing.css - no JS scroll handler
 * needed, and nothing here computes from the current time.
 */
"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { Icon, Wordmark } from "./icons"
import { navigation, siteConfig } from "./site-config"
import { ConnectCta } from "./connect-cta"

export function Navbar({ signedIn }: { signedIn: boolean }) {
  const [scrolled, setScrolled] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 12)
    onScroll()
    window.addEventListener("scroll", onScroll, { passive: true })
    return () => window.removeEventListener("scroll", onScroll)
  }, [])

  useEffect(() => {
    if (!menuOpen) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setMenuOpen(false)
        document.getElementById("mobile-menu-toggle")?.focus()
      }
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [menuOpen])

  return (
    <header className="site-header" data-scrolled={scrolled}>
      <div className="container navbar">
        <a href="#top" className="brand-link" aria-label="CleanExporter home" onClick={() => setMenuOpen(false)}>
          <Wordmark />
        </a>
        <nav className="desktop-navigation" aria-label="Main navigation">
          {navigation.map((item) => (
            <a key={item.href} href={item.href}>
              {item.label}
            </a>
          ))}
        </nav>
        <div className="navbar-actions">
          {signedIn ? (
            <Link href="/dashboard" className="login-link">
              Go to dashboard
            </Link>
          ) : (
            <>
              <Link href={siteConfig.loginUrl} className="login-link">
                Log in
              </Link>
              <ConnectCta signedIn={false} label="Start free" className="navbar-cta" />
            </>
          )}
          <button
            id="mobile-menu-toggle"
            className="mobile-menu-toggle"
            type="button"
            aria-label={menuOpen ? "Close navigation menu" : "Open navigation menu"}
            aria-expanded={menuOpen}
            aria-controls="mobile-navigation"
            onClick={() => setMenuOpen(!menuOpen)}
          >
            <Icon name={menuOpen ? "close" : "menu"} size={22} />
          </button>
        </div>
      </div>
      <nav id="mobile-navigation" className="mobile-navigation" aria-label="Mobile navigation" hidden={!menuOpen}>
        <div className="container">
          {navigation.map((item) => (
            <a key={item.href} href={item.href} onClick={() => setMenuOpen(false)}>
              {item.label}
              <Icon name="arrow-up-right" size={16} />
            </a>
          ))}
          {signedIn ? (
            <Link href="/dashboard" onClick={() => setMenuOpen(false)}>
              Go to dashboard <Icon name="arrow-right" size={16} />
            </Link>
          ) : (
            <Link href={siteConfig.loginUrl} onClick={() => setMenuOpen(false)}>
              Log in <Icon name="arrow-right" size={16} />
            </Link>
          )}
        </div>
      </nav>
    </header>
  )
}
