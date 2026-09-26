// DEYOTLAN: pure logic for tag filtering and unresolved-link detection.
/**
 * Everything here is derived from `contentIndex.json`, which the build already emits
 * and every page already loads. No new build step, no new data file.
 */

export interface IndexEntry {
  slug: string
  filePath?: string
  title?: string
  links?: string[]
  tags?: string[]
}

export interface TagCount {
  tag: string
  count: number
}

export type CombineMode = "and" | "or"

/** Pages the nav and these views consider real content. */
export function contentEntries(index: Record<string, IndexEntry>): IndexEntry[] {
  return Object.entries(index)
    .map(([slug, e]) => ({ ...e, slug: e.slug ?? slug }))
    .filter((e) => e.slug !== "tags" && !e.slug.startsWith("tags/"))
}

/** Tags with their page counts, most used first, ties broken alphabetically. */
export function tagCounts(entries: IndexEntry[]): TagCount[] {
  const counts = new Map<string, number>()
  for (const e of entries) {
    for (const tag of e.tags ?? []) {
      counts.set(tag, (counts.get(tag) ?? 0) + 1)
    }
  }
  return [...counts]
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag))
}

/**
 * Filter by tags.
 *
 * "and" is the default elsewhere because intersection is the thing the built-in
 * search cannot already do.
 */
export function filterByTags(
  entries: IndexEntry[],
  selected: string[],
  mode: CombineMode,
): IndexEntry[] {
  if (selected.length === 0) return entries
  const wanted = new Set(selected)
  return entries.filter((e) => {
    const tags = new Set(e.tags ?? [])
    return mode === "and"
      ? [...wanted].every((t) => tags.has(t))
      : [...wanted].some((t) => tags.has(t))
  })
}

/**
 * Resolve a wikilink target against the set of real slugs.
 *
 * Mirrors `markdownLinkResolution: shortest`, which is what quartz.config.yaml sets:
 * a bare target matches any page whose path ends with it, and folder index pages are
 * reachable by their folder name.
 */
export function resolvesToPage(
  target: string,
  slugs: Set<string>,
  aliases: Set<string> = new Set(),
): boolean {
  if (slugs.has(target)) return true
  // Alias redirect stubs are real destinations even though they never appear in
  // contentIndex.json, so a link through one is not broken.
  if (aliases.has(target)) return true
  if (slugs.has(`${target}/index`)) return true
  for (const slug of slugs) {
    if (slug.endsWith(`/${target}`)) return true
    if (slug.endsWith(`/${target}/index`)) return true
  }
  return false
}

export interface Orphan {
  target: string
  sources: string[]
}

/**
 * Wikilinks pointing at pages that do not exist.
 *
 * Pure set arithmetic over data the build already emits, so this costs nothing and
 * cannot drift out of date.
 */
export function unresolvedLinks(entries: IndexEntry[], aliases: Set<string> = new Set()): Orphan[] {
  const slugs = new Set(entries.map((e) => e.slug))
  const missing = new Map<string, Set<string>>()

  for (const entry of entries) {
    for (const link of entry.links ?? []) {
      if (!link || link.startsWith("http://") || link.startsWith("https://")) continue
      // Strip any heading or block anchor before resolving.
      const target = link.split("#")[0].replace(/\/$/, "")
      if (!target) continue
      if (resolvesToPage(target, slugs, aliases)) continue
      const sources = missing.get(target) ?? new Set<string>()
      sources.add(entry.slug)
      missing.set(target, sources)
    }
  }

  return [...missing]
    .map(([target, sources]) => ({ target, sources: [...sources].sort() }))
    .sort((a, b) => b.sources.length - a.sources.length || a.target.localeCompare(b.target))
}

/** A readable title for a slug that has no index entry. */
export function humanise(target: string): string {
  const last = target.split("/").pop() ?? target
  return last
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase())
}
