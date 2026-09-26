// DEYOTLAN: pure reconciliation logic for the curated navigation.
/**
 * Turns the generated content index plus a curated manifest into the list of groups
 * to paint. Kept free of any DOM access so it can be reasoned about and unit-tested
 * directly (see reconcile.test.ts).
 *
 * Two invariants drive the design:
 *
 *  1. **No page can become invisible.** Anything the manifest does not mention is
 *     placed automatically -- by folder hint if one matches, otherwise into a
 *     fallback group. A page created by the admin therefore appears in the right
 *     place without the manifest being edited at all.
 *  2. **A stale manifest is harmless.** Entries for pages that no longer exist are
 *     dropped, and groups that end up empty are not rendered, so deleting a page can
 *     never leave a broken link or an orphaned heading behind.
 */

export interface ContentDetails {
  slug: string
  filePath?: string
  title?: string
  links?: string[]
  tags?: string[]
  dates?: Record<string, string>
  sessionDate?: string
}

export interface NavItem {
  slug: string
  label?: string
}

export interface NavGroup {
  id: string
  label: string
  collapsed?: boolean
  /** Auto-placement only -- never a rendering rule. Groups are not folders. */
  folderHints?: string[]
  autoSort?: "title" | "date-desc" | "append"
  items?: NavItem[]
}

export interface NavManifest {
  version: number
  updatedAt?: string
  groups: NavGroup[]
  hidden?: string[]
  fallbackGroupLabel?: string
}

export interface RenderedItem {
  slug: string
  label: string
  url: string
}

export interface RenderedGroup {
  id: string
  label: string
  collapsed: boolean
  items: RenderedItem[]
}

export const UNFILED_GROUP_ID = "__unfiled__"

/** Folder index pages are reachable at the folder URL, not at ".../index". */
export function displaySlug(slug: string): string {
  return slug.endsWith("/index") ? slug.slice(0, -"/index".length) : slug
}

/**
 * Slugs can contain characters such as ";" (the legacy session note), so each
 * segment is encoded individually rather than the path as a whole.
 */
export function urlForSlug(slug: string, basePath = ""): string {
  const encoded = slug
    .split("/")
    .map((s) => encodeURIComponent(s))
    .join("/")
  return `${basePath}/${encoded}`
}

/** Tag pages are generated rather than authored, so they never appear in the nav. */
function isNavigable(slug: string): boolean {
  return slug !== "tags" && !slug.startsWith("tags/")
}

export function reconcile(
  index: Record<string, ContentDetails>,
  manifest: NavManifest | null,
  basePath = "",
  /**
   * Slug -> YYYY-MM-DD, from /static/wiki-meta.json. The generated content index
   * carries no dates at all, so without this `autoSort: "date-desc"` is inert.
   */
  dates: Record<string, string> = {},
): RenderedGroup[] {
  const entries = Object.entries(index)
    .map(([slug, d]) => ({ ...d, slug: d.slug ?? slug }))
    .filter((d) => isNavigable(d.slug))

  const bySlug = new Map(entries.map((d) => [d.slug, d]))

  const titleOf = (slug: string, override?: string): string => {
    if (override) return override
    const d = bySlug.get(slug)
    if (d?.title && d.title !== "index") return d.title
    const seg = displaySlug(slug).split("/").pop() ?? slug
    return seg.replace(/[-_]/g, " ")
  }

  const dateOf = (slug: string): string => {
    const d = bySlug.get(slug)
    return dates[slug] ?? d?.sessionDate ?? d?.dates?.modified ?? d?.dates?.created ?? ""
  }

  const sortSlugs = (slugs: string[], mode: NavGroup["autoSort"]): string[] => {
    if (mode === "append") return slugs
    if (mode === "date-desc") {
      return [...slugs].sort((a, b) => {
        const cmp = dateOf(b).localeCompare(dateOf(a))
        return cmp !== 0 ? cmp : titleOf(a).localeCompare(titleOf(b))
      })
    }
    return [...slugs].sort((a, b) =>
      titleOf(a).localeCompare(titleOf(b), undefined, { numeric: true, sensitivity: "base" }),
    )
  }

  const toItem = (slug: string, label?: string): RenderedItem => ({
    slug,
    label: titleOf(slug, label),
    url: urlForSlug(displaySlug(slug), basePath),
  })

  // --- fallback: plain folder tree, one group per top-level folder ---
  if (!manifest) {
    const buckets = new Map<string, string[]>()
    for (const d of entries) {
      const parts = displaySlug(d.slug).split("/")
      const key = parts.length > 1 ? parts[0] : ""
      const list = buckets.get(key) ?? []
      list.push(d.slug)
      buckets.set(key, list)
    }
    return [...buckets]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([key, slugs]) => ({
        id: key || "root",
        label: key ? key.replace(/-/g, " ") : "Pages",
        collapsed: false,
        items: sortSlugs(slugs, "title").map((s) => toItem(s)),
      }))
      .filter((g) => g.items.length > 0)
  }

  // --- manifest-driven ---
  const hidden = new Set(manifest.hidden ?? [])
  const claimed = new Set<string>(hidden)
  for (const g of manifest.groups) {
    for (const item of g.items ?? []) claimed.add(item.slug)
  }

  // Longest hint wins, so a nested folder is not swallowed by an ancestor's hint.
  const hintOwners: { groupId: string; hint: string }[] = []
  for (const g of manifest.groups) {
    for (const hint of g.folderHints ?? []) hintOwners.push({ groupId: g.id, hint })
  }
  hintOwners.sort((a, b) => b.hint.length - a.hint.length)

  const ownerFor = (slug: string): string | null => {
    for (const { groupId, hint } of hintOwners) {
      if (slug === hint || slug.startsWith(hint + "/")) return groupId
    }
    return null
  }

  const autoBuckets = new Map<string, string[]>()
  const leftovers: string[] = []
  for (const d of entries) {
    if (claimed.has(d.slug)) continue
    const owner = ownerFor(d.slug)
    if (owner) {
      const list = autoBuckets.get(owner) ?? []
      list.push(d.slug)
      autoBuckets.set(owner, list)
    } else {
      leftovers.push(d.slug)
    }
  }

  const out: RenderedGroup[] = []
  for (const g of manifest.groups) {
    // Curated items keep manifest order; auto-placed pages follow, sorted.
    const curated = (g.items ?? []).filter((i) => bySlug.has(i.slug))
    const autos = sortSlugs(autoBuckets.get(g.id) ?? [], g.autoSort ?? "title")

    const items = [...curated.map((i) => toItem(i.slug, i.label)), ...autos.map((s) => toItem(s))]

    if (items.length === 0) continue
    out.push({ id: g.id, label: g.label, collapsed: g.collapsed === true, items })
  }

  if (leftovers.length > 0) {
    out.push({
      id: UNFILED_GROUP_ID,
      label: manifest.fallbackGroupLabel ?? "Unfiled",
      collapsed: false,
      items: sortSlugs(leftovers, "title").map((s) => toItem(s)),
    })
  }

  return out
}
