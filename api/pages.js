/**
 * Create, read and update content pages.
 *
 *   GET  /api/pages?path=content/Foo/Bar.md   -> read a page for editing
 *   POST /api/pages { action: "create", ... } -> create a new page
 *   POST /api/pages { action: "update", ... } -> overwrite an existing page
 */
import { handler, send, requireMethod, readJson, query, HttpError } from "./_lib/http.js"
import { guard, isAuthenticated } from "./_lib/auth.js"
import { readFile, exists, commitFiles, headSha, isLocalBackend } from "./_lib/store.js"
import {
  CONTENT_ROOT,
  safeName,
  validateRepoPath,
  parseDocument,
  serializeDocument,
  mergeFrontmatter,
  toTagArray,
  deriveTitle,
  normalizeBody,
} from "./_lib/md.js"

/** Folder must be content/ or a subdirectory of it, with no traversal. */
function normalizeFolder(folder) {
  const raw = String(folder ?? CONTENT_ROOT)
    .trim()
    .replace(/^\/+|\/+$/g, "")
  const f = raw === "" ? CONTENT_ROOT : raw
  if (f !== CONTENT_ROOT && !f.startsWith(CONTENT_ROOT + "/")) {
    throw new HttpError(400, "bad_folder", `Folder must be inside ${CONTENT_ROOT}/.`)
  }
  if (f.includes("..") || f.includes("\\") || f.includes("//")) {
    throw new HttpError(400, "bad_folder", "Folder path is not valid.")
  }
  return f
}

async function handleGet(req, res) {
  if (!isAuthenticated(req)) {
    throw new HttpError(401, "unauthorized", "Sign in to continue.")
  }
  const path = query(req).get("path")
  if (!path) throw new HttpError(400, "missing_path", "A path query parameter is required.")
  validateRepoPath(path)

  const file = await readFile(path)
  if (!file) throw new HttpError(404, "not_found", `No such page: ${path}`)

  const { data, body } = parseDocument(file.content)
  send(res, 200, {
    path,
    raw: file.content,
    frontmatter: data ?? {},
    body,
    sha: file.sha,
    headSha: await headSha(),
  })
}

async function handleCreate(req, res, payload) {
  const title = String(payload.title ?? "").trim()
  if (title === "") throw new HttpError(400, "missing_title", "A title is required.")

  const folder = normalizeFolder(payload.folder)
  const path = `${folder}/${safeName(title)}.md`
  validateRepoPath(path)

  if (await exists(path)) {
    throw new HttpError(409, "already_exists", "A page with that title already exists here.", {
      path,
    })
  }

  const now = new Date().toISOString()
  const { data: userData, body: rawBody } = parseDocument(payload.body ?? "")

  // Only consume a leading H1 when the author gave no explicit title in frontmatter.
  let body = normalizeBody(rawBody)
  if (!userData?.title) {
    const derived = deriveTitle(body, title)
    if (derived.title === title || !payload.title) body = derived.body
  }

  const template = {
    title,
    publish: payload.unlisted === true ? false : true,
    created: now,
    modified: now,
    tags: toTagArray(payload.tags),
  }
  if (template.tags.length === 0) delete template.tags

  const frontmatter = mergeFrontmatter(template, userData ?? {})
  const content = serializeDocument(frontmatter, body)

  const result = await commitFiles({
    files: [{ path, content }],
    message: `Create ${title}\n\nvia admin: pages/create`,
  })

  send(res, 201, {
    path,
    commit: result.commit,
    local: isLocalBackend(),
    slug: pathToSlug(path),
  })
}

async function handleUpdate(req, res, payload) {
  const path = String(payload.path ?? "")
  validateRepoPath(path)

  const current = await readFile(path)
  if (!current) throw new HttpError(404, "not_found", `No such page: ${path}`)

  const now = new Date().toISOString()
  const { data: userData, body } = parseDocument(payload.body ?? "")

  // Preserve whatever the file already had, let the submitted frontmatter override,
  // and always refresh `modified`.
  const { data: existingData } = parseDocument(current.content)
  const frontmatter = {
    ...(existingData ?? {}),
    ...(userData ?? {}),
    modified: now,
  }
  const content = serializeDocument(frontmatter, body)

  if (content === current.content) {
    return send(res, 200, { path, commit: null, unchanged: true, slug: pathToSlug(path) })
  }

  const result = await commitFiles({
    files: [{ path, content }],
    message: `Update ${frontmatter.title ?? path}\n\nvia admin: pages/update`,
    expectedHeadSha: payload.force === true ? undefined : payload.headSha,
  })

  send(res, 200, {
    path,
    commit: result.commit,
    local: isLocalBackend(),
    slug: pathToSlug(path),
  })
}

/**
 * Mirror Quartz's slugification closely enough to build a preview link.
 * Authoritative slugs come from the build; this is only used for "open the page".
 */
function pathToSlug(repoPath) {
  return repoPath
    .replace(/^content\//, "")
    .replace(/\.md$/, "")
    .split("/")
    .map((seg) => seg.toLowerCase().replace(/\s+/g, "-"))
    .join("/")
}

export default handler(async (req, res) => {
  if (req.method === "GET") return handleGet(req, res)
  if (!requireMethod(req, res, ["GET", "POST"])) return
  if (!guard(req, res)) return

  const payload = await readJson(req)
  const action = String(payload.action ?? "")

  if (action === "create") return handleCreate(req, res, payload)
  if (action === "update") return handleUpdate(req, res, payload)

  throw new HttpError(400, "bad_action", 'Expected action to be "create" or "update".')
})
