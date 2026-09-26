/**
 * The curated navigation manifest.
 *
 *   GET  /api/nav  -> the current manifest plus the head sha it was read at
 *   POST /api/nav  -> replace it wholesale
 *
 * Whole-document replacement rather than patches: the document is a few kilobytes
 * and there is exactly one editor, so a patch protocol would be complexity without
 * a corresponding benefit.
 */
import { handler, send, requireMethod, readJson, HttpError } from "./_lib/http.js"
import { guard, isAuthenticated } from "./_lib/auth.js"
import { readFile, commitFiles, headSha, isLocalBackend } from "./_lib/store.js"

export const NAV_PATH = "quartz/static/nav.json"

const MAX_GROUPS = 64
const MAX_ITEMS_PER_GROUP = 500

/**
 * Validate and normalise a submitted manifest.
 *
 * Also deduplicates: a slug appearing in two groups would render twice, so the first
 * occurrence wins and later ones are dropped.
 */
function sanitize(input) {
  if (!input || typeof input !== "object") {
    throw new HttpError(400, "bad_manifest", "Manifest must be an object.")
  }
  if (input.version !== 1) {
    throw new HttpError(400, "bad_version", "Only manifest version 1 is supported.")
  }
  if (!Array.isArray(input.groups)) {
    throw new HttpError(400, "bad_manifest", "Manifest.groups must be an array.")
  }
  if (input.groups.length > MAX_GROUPS) {
    throw new HttpError(400, "too_many_groups", `At most ${MAX_GROUPS} groups.`)
  }

  const str = (v, max = 200) => {
    const s = String(v ?? "").trim()
    return s.length > max ? s.slice(0, max) : s
  }

  const seenSlugs = new Set()
  const seenIds = new Set()
  const groups = []

  for (const g of input.groups) {
    if (!g || typeof g !== "object") continue
    const id = str(g.id, 64)
    const label = str(g.label, 120)
    if (!id || !label) {
      throw new HttpError(400, "bad_group", "Every group needs a non-empty id and label.")
    }
    if (seenIds.has(id)) {
      throw new HttpError(400, "duplicate_group", `Duplicate group id: ${id}`)
    }
    seenIds.add(id)

    const rawItems = Array.isArray(g.items) ? g.items : []
    if (rawItems.length > MAX_ITEMS_PER_GROUP) {
      throw new HttpError(400, "too_many_items", `At most ${MAX_ITEMS_PER_GROUP} items per group.`)
    }

    const items = []
    for (const item of rawItems) {
      const slug = str(typeof item === "string" ? item : item?.slug, 300)
      if (!slug) continue
      // Tag pages are generated and never belong in the manifest.
      if (slug === "tags" || slug.startsWith("tags/")) continue
      if (seenSlugs.has(slug)) continue
      seenSlugs.add(slug)
      const label = typeof item === "object" ? str(item?.label, 160) : ""
      items.push(label ? { slug, label } : { slug })
    }

    const group = { id, label, items }
    if (g.collapsed === true) group.collapsed = true
    if (Array.isArray(g.folderHints)) {
      const hints = g.folderHints.map((h) => str(h, 300)).filter(Boolean)
      if (hints.length > 0) group.folderHints = hints
    }
    if (g.autoSort === "title" || g.autoSort === "date-desc" || g.autoSort === "append") {
      group.autoSort = g.autoSort
    }
    groups.push(group)
  }

  const hidden = Array.isArray(input.hidden)
    ? [...new Set(input.hidden.map((h) => str(h, 300)).filter(Boolean))]
    : []

  return {
    version: 1,
    updatedAt: new Date().toISOString(),
    groups,
    hidden,
    fallbackGroupLabel: str(input.fallbackGroupLabel, 80) || "Unfiled",
  }
}

async function handleGet(req, res) {
  const file = await readFile(NAV_PATH)
  send(res, 200, {
    manifest: file ? JSON.parse(file.content) : null,
    headSha: await headSha(),
  })
}

async function handlePost(req, res) {
  const payload = await readJson(req)
  const manifest = sanitize(payload.manifest)

  const content = JSON.stringify(manifest, null, 2) + "\n"

  const current = await readFile(NAV_PATH)
  if (current && current.content === content.replace(/"updatedAt":[^,]+,/, "")) {
    // Unreachable in practice because updatedAt always changes; kept as a guard so a
    // future caller that preserves updatedAt does not produce an empty commit.
    return send(res, 200, { unchanged: true, commit: null })
  }

  const result = await commitFiles({
    files: [{ path: NAV_PATH, content }],
    message: `Reorder navigation\n\nvia admin: nav`,
    expectedHeadSha: payload.force === true ? undefined : payload.headSha,
  })

  send(res, 200, {
    commit: result.commit,
    local: isLocalBackend(),
    groups: manifest.groups.length,
    items: manifest.groups.reduce((n, g) => n + g.items.length, 0),
  })
}

export default handler(async (req, res) => {
  if (req.method === "GET") {
    if (!isAuthenticated(req)) throw new HttpError(401, "unauthorized", "Sign in to continue.")
    return handleGet(req, res)
  }
  if (!requireMethod(req, res, ["GET", "POST"])) return
  if (!guard(req, res)) return
  return handlePost(req, res)
})
