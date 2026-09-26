// DEYOTLAN: first-party emitter for the /admin authoring surface.
import { JSX } from "preact"
import { FullSlug } from "../../util/path"
import { QuartzEmitterPlugin } from "../types"
import { write } from "./helpers"
import { renderAdminDocument, AdminPageName } from "../../components/admin/AdminDocument"
import { DashboardView, NewPageView, QuickNoteView, BrowseView } from "../../components/admin/views"
import adminStyles from "../../styles/admin.scss"
import adminScript from "../../components/scripts/admin.inline"
import browseStyles from "../../styles/browse.scss"
import browseScript from "../../components/scripts/browse.inline"

interface AdminPageSpec {
  slug: FullSlug
  page: AdminPageName
  title: string
  body: () => JSX.Element
  /** /browse is public; the admin pages are gated behind the login overlay. */
  requireAuth?: boolean
  css?: string
  script?: string
}

const PAGES: AdminPageSpec[] = [
  { slug: "admin/index" as FullSlug, page: "dashboard", title: "Pages", body: DashboardView },
  { slug: "admin/new/index" as FullSlug, page: "new", title: "New page", body: NewPageView },
  {
    slug: "admin/quick/index" as FullSlug,
    page: "quick",
    title: "Session notes",
    body: QuickNoteView,
  },
  {
    slug: "browse/index" as FullSlug,
    page: "browse",
    title: "Browse by tag",
    body: BrowseView,
    requireAuth: false,
    css: browseStyles,
    script: browseScript,
  },
]

/**
 * Emits the admin application as standalone HTML.
 *
 * These pages never enter `ctx.allFiles`, so they cannot leak into contentIndex.json,
 * the sitemap, the RSS feed, search or the navigation. That exclusion is structural
 * rather than a filter someone has to maintain.
 *
 * Also emits `static/build-info.json`, recording the commit this build came from. The
 * admin polls that file to tell when a save has actually gone live, which avoids
 * needing a Vercel API token and measures the thing that matters (is my change
 * visible) rather than deployment state.
 */
export const AdminPages: QuartzEmitterPlugin = () => ({
  name: "AdminPages",
  async *emit(ctx, content) {
    const siteTitle = ctx.cfg.configuration.pageTitle ?? "Deyotlan Lore"

    for (const spec of PAGES) {
      const html = renderAdminDocument({
        page: spec.page,
        title: spec.title,
        css: spec.css ?? adminStyles,
        script: spec.script ?? adminScript,
        siteTitle,
        body: spec.body(),
        requireAuth: spec.requireAuth ?? true,
      })
      yield await write({ ctx, slug: spec.slug, ext: ".html", content: html })
    }

    // robots.txt must live at the site root -- quartz/static/** would put it at
    // /static/robots.txt, which no crawler reads.
    const baseUrl = ctx.cfg.configuration.baseUrl
    yield await write({
      ctx,
      slug: "robots" as FullSlug,
      ext: ".txt",
      content: [
        "# Deyotlan Lore",
        "User-agent: *",
        "Disallow: /admin",
        "Disallow: /api/",
        "",
        baseUrl ? `Sitemap: https://${baseUrl}/sitemap.xml` : "",
        "",
      ].join("\n"),
    })

    // Supplementary metadata the client needs but contentIndex.json does not carry.
    //
    //  - Alias slugs are emitted as redirect stubs by
    //    @quartz-community/alias-redirects but never enter the content index, so
    //    without them /browse would report links through an alias as broken.
    //  - The content index carries no dates whatsoever (only slug, filePath, title,
    //    links, tags and content), so the navigation cannot sort sessions newest-first
    //    without them.
    //
    // Both live in one file so the client makes a single extra request.
    const aliases: Record<string, string> = {}
    const dates: Record<string, string> = {}

    for (const [, file] of content) {
      const slug = file.data.slug
      if (!slug) continue

      for (const alias of (file.data.aliases ?? []) as string[]) {
        if (typeof alias === "string" && alias.length > 0) aliases[alias] = slug
      }

      const fm = (file.data.frontmatter ?? {}) as Record<string, unknown>
      const fileDates = (file.data.dates ?? {}) as Record<string, Date | string | undefined>
      const candidate =
        fm.sessionDate ?? fileDates.modified ?? fileDates.created ?? fm.modified ?? fm.created
      if (candidate) {
        const iso = candidate instanceof Date ? candidate.toISOString() : String(candidate)
        // Date-only form is enough to sort by and keeps the file small.
        dates[slug] = iso.slice(0, 10)
      }
    }

    yield await write({
      ctx,
      slug: "static/wiki-meta" as FullSlug,
      ext: ".json",
      content: JSON.stringify({ aliases, dates }),
    })

    yield await write({
      ctx,
      slug: "static/build-info" as FullSlug,
      ext: ".json",
      content: JSON.stringify({
        commit: process.env.VERCEL_GIT_COMMIT_SHA ?? "local",
        builtAt: new Date().toISOString(),
      }),
    })
  },
  async *partialEmit() {},
})
