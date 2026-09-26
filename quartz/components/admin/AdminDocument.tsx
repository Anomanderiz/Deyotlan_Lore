/**
 * Standalone HTML document for the /admin surface.
 *
 * The admin is deliberately NOT a Quartz content page. It never enters `ctx.allFiles`,
 * so it cannot appear in contentIndex.json, sitemap.xml, index.xml, search or the nav
 * -- exclusion is a property of how it is built rather than a filter someone has to
 * remember to maintain. It also means none of the site chrome (explorer, backlinks,
 * popovers, SPA router) is loaded here, which keeps the admin fast and independent.
 *
 * CSS and JS are inlined rather than linked: the admin is a handful of KB, inlining
 * removes two round trips on table wifi, and it sidesteps any dependency on the
 * content-hashed asset names that the ComponentResources emitter produces.
 */
import { render } from "preact-render-to-string"
import { JSX } from "preact"

export type AdminPageName = "dashboard" | "new" | "quick" | "browse"

export interface AdminDocumentOptions {
  page: AdminPageName
  title: string
  css: string
  script: string
  siteTitle: string
  body: JSX.Element
  /**
   * Whether the page is gated behind the admin login. /browse is public, so it
   * renders its body immediately with no login overlay.
   */
  requireAuth?: boolean
}

/**
 * Runs before first paint to stop the admin flashing the wrong theme.
 * Mirrors the key the site's darkmode plugin writes, so the two surfaces agree.
 */
const THEME_BOOTSTRAP = `
(function () {
  try {
    var saved = localStorage.getItem("theme");
    var dark = saved ? saved === "dark"
      : !window.matchMedia("(prefers-color-scheme: light)").matches;
    document.documentElement.setAttribute("data-theme", dark ? "dark" : "light");
  } catch (e) {
    document.documentElement.setAttribute("data-theme", "dark");
  }
})();
`.trim()

export function renderAdminDocument(opts: AdminDocumentOptions): string {
  const { page, title, css, script, siteTitle, body, requireAuth = true } = opts

  const doc = (
    <html lang="en" data-theme="dark">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
        {/* Belt and braces alongside the X-Robots-Tag header in vercel.json. */}
        {requireAuth ? <meta name="robots" content="noindex, nofollow, noarchive" /> : null}
        <meta name="referrer" content="same-origin" />
        <meta name="color-scheme" content="dark light" />
        <title>{`${title} · ${siteTitle}`}</title>
        <link rel="icon" href="/static/icon.png" />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;600&family=Schibsted+Grotesk:wght@400;600;700&family=Source+Sans+3:wght@400;600&display=swap"
        />
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOTSTRAP }} />
        <style dangerouslySetInnerHTML={{ __html: css }} />
      </head>
      <body data-admin-page={page}>
        {/* Shown until the session check resolves, so an anonymous visitor never
            sees admin controls flash before being asked to sign in. */}
        {requireAuth ? (
          <div class="admin-login" id="admin-login" hidden>
            <div class="admin-panel">
              <h1>Deyotlan Lore</h1>
              <p class="admin-hint">Sign in to edit the wiki.</p>
              <form id="admin-login-form" autocomplete="on">
                <label class="admin-field">
                  <span>Password</span>
                  <input
                    type="password"
                    id="admin-password"
                    name="password"
                    autocomplete="current-password"
                    required
                  />
                </label>
                <button type="submit" class="primary big" id="admin-login-submit">
                  Sign in
                </button>
              </form>
              <p class="admin-status" id="admin-login-status" role="status" aria-live="polite" />
            </div>
          </div>
        ) : null}

        <div id="admin-app" hidden={requireAuth}>
          {body}
        </div>

        <noscript>
          <div class="admin-shell">
            <div class="admin-panel">
              <h2>JavaScript required</h2>
              <p class="admin-hint">This page needs JavaScript to load the wiki index.</p>
            </div>
          </div>
        </noscript>

        <script type="module" dangerouslySetInnerHTML={{ __html: script }} />
      </body>
    </html>
  )

  return "<!DOCTYPE html>\n" + render(doc)
}

/** Shared chrome: topbar and section nav. */
export function AdminChrome({ current }: { current: AdminPageName }) {
  return (
    <>
      <header class="admin-topbar">
        <h1 class="admin-brand">
          Deyotlan <span class="admin-brand-sub">Admin</span>
        </h1>
        <div class="admin-topbar-spacer" />
        <button
          type="button"
          class="admin-icon-button"
          id="admin-theme-toggle"
          title="Toggle theme"
        >
          <span aria-hidden="true">◐</span>
          <span class="visually-hidden">Toggle light and dark theme</span>
        </button>
        <button type="button" class="admin-icon-button" id="admin-logout">
          Sign out
        </button>
      </header>
      <nav class="admin-nav" aria-label="Admin sections">
        <a
          href="/admin/quick"
          class="admin-nav-primary"
          aria-current={current === "quick" ? "page" : undefined}
        >
          Session notes
        </a>
        <a href="/admin" aria-current={current === "dashboard" ? "page" : undefined}>
          Pages
        </a>
        <a href="/admin/new" aria-current={current === "new" ? "page" : undefined}>
          New page
        </a>
        <a href="/">View site</a>
      </nav>
    </>
  )
}
