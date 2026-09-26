/**
 * Quick-add session notes.
 *
 *   GET  /api/session-note  -> what a save would do right now (number, date, append?)
 *   POST /api/session-note  -> create today's note, or append to it
 *
 * Designed for one-thumb use at the table: the client sends a blob of text and
 * everything else is derived here.
 */
import { handler, send, requireMethod, readJson, HttpError } from "./_lib/http.js"
import { guard, isAuthenticated } from "./_lib/auth.js"
import { listDir, readFile, commitFiles, isLocalBackend } from "./_lib/store.js"
import {
  SESSION_NOTES_DIR,
  SESSION_DEFAULT_TAGS,
  parseDocument,
  serializeDocument,
  mergeFrontmatter,
  toTagArray,
  normalizeBody,
  localDateISO,
  localTimeHHMM,
  validateRepoPath,
} from "./_lib/md.js"

/**
 * Timezone resolution. At a table at 11pm, UTC would file the note under tomorrow,
 * so this is worth the three lines.
 */
function timeZoneFor(req) {
  return process.env.SESSION_TZ || req.headers?.["x-vercel-ip-timezone"] || "UTC"
}

/**
 * Highest existing session number + 1.
 *
 * The regex matches both the legacy `Session 5; 2-09-2026.md` and the new
 * `session-06-2026-09-24.md`, so the two conventions coexist and only this one
 * expression has to understand both.
 */
function nextSessionNumber(names) {
  const nums = names
    .map((n) => n.match(/session[\s_-]*0*(\d+)/i))
    .filter(Boolean)
    .map((m) => Number(m[1]))
    .filter((n) => Number.isFinite(n))
  return nums.length > 0 ? Math.max(...nums) + 1 : 1
}

function noteFileName(sessionNumber, dateISO) {
  // Zero-padded number first so lexical order matches chronological order; ISO date
  // second so it is unambiguous and sortable. No spaces, no semicolon.
  return `session-${String(sessionNumber).padStart(2, "0")}-${dateISO}.md`
}

/** Find a note already filed under today's date, whatever its number. */
function findTodaysNote(names, dateISO) {
  return names.find((n) => n.includes(dateISO)) ?? null
}

async function describe(req) {
  const tz = timeZoneFor(req)
  const dateISO = localDateISO(tz)
  const entries = await listDir(SESSION_NOTES_DIR)
  const names = entries
    .filter((e) => e.type === "file" && e.name.endsWith(".md"))
    .map((e) => e.name)

  const todays = findTodaysNote(names, dateISO)
  return {
    timeZone: tz,
    date: dateISO,
    time: localTimeHHMM(tz),
    nextNumber: nextSessionNumber(names),
    existingToday: todays,
    mode: todays ? "append" : "create",
    existingCount: names.length,
  }
}

async function handleGet(req, res) {
  if (!isAuthenticated(req)) throw new HttpError(401, "unauthorized", "Sign in to continue.")
  send(res, 200, await describe(req))
}

async function handlePost(req, res) {
  const payload = await readJson(req)
  const text = normalizeBody(payload.body ?? "")
  // trim(), not === "": normalizeBody strips newlines but not spaces, and a
  // whitespace-only body would otherwise append an empty timestamped section.
  if (text.trim() === "") throw new HttpError(400, "empty", "There is nothing to save.")

  const info = await describe(req)
  const tz = info.timeZone
  const dateISO = typeof payload.date === "string" && payload.date ? payload.date : info.date
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateISO)) {
    throw new HttpError(400, "bad_date", "Date must be YYYY-MM-DD.")
  }

  const wantsAppend = payload.mode === "append" || (payload.mode !== "create" && info.existingToday)

  // --- append to today's note -------------------------------------------------
  if (wantsAppend && info.existingToday) {
    const path = `${SESSION_NOTES_DIR}/${info.existingToday}`
    validateRepoPath(path)

    const current = await readFile(path)
    if (!current) throw new HttpError(404, "not_found", "Today's note disappeared; reload.")

    const { data, body } = parseDocument(current.content)
    const heading = `## ${localTimeHHMM(tz)}`
    const appended = `${body}\n\n${heading}\n\n${text}`
    const content = serializeDocument(
      { ...(data ?? {}), modified: new Date().toISOString() },
      appended,
    )

    const result = await commitFiles({
      files: [{ path, content }],
      message: `Append to ${info.existingToday}\n\nvia admin: session-note/append`,
      expectedHeadSha: payload.force === true ? undefined : payload.headSha,
    })

    return send(res, 200, {
      mode: "append",
      path,
      heading,
      commit: result.commit,
      local: isLocalBackend(),
      slug: slugFor(info.existingToday),
    })
  }

  // --- create a new note ------------------------------------------------------
  const sessionNumber = Number.isInteger(payload.session) ? payload.session : info.nextNumber
  const fileName = noteFileName(sessionNumber, dateISO)
  const path = `${SESSION_NOTES_DIR}/${fileName}`
  validateRepoPath(path)

  const existing = await readFile(path)
  if (existing) {
    throw new HttpError(409, "already_exists", "A note with that number and date already exists.", {
      path,
    })
  }

  const now = new Date().toISOString()
  const { data: userData, body } = parseDocument(text)

  const template = {
    // Explicit, so the filename never surfaces in the UI, the nav or breadcrumbs.
    title: `Session ${sessionNumber} — ${dateISO}`,
    publish: true,
    created: now,
    modified: now,
    tags: [...SESSION_DEFAULT_TAGS, ...toTagArray(payload.tags)],
    // Scalars the nav can sort on without parsing filenames.
    session: sessionNumber,
    sessionDate: dateISO,
  }

  const frontmatter = mergeFrontmatter(template, userData ?? {})
  const content = serializeDocument(frontmatter, body)

  const result = await commitFiles({
    files: [{ path, content }],
    message: `Session ${sessionNumber} (${dateISO})\n\nvia admin: session-note/create`,
  })

  send(res, 201, {
    mode: "create",
    path,
    session: sessionNumber,
    date: dateISO,
    commit: result.commit,
    local: isLocalBackend(),
    slug: slugFor(fileName),
  })
}

function slugFor(fileName) {
  return `five-banners-burning-campaign/session-notes/${fileName
    .replace(/\.md$/, "")
    .toLowerCase()
    .replace(/\s+/g, "-")}`
}

export default handler(async (req, res) => {
  if (req.method === "GET") return handleGet(req, res)
  if (!requireMethod(req, res, ["GET", "POST"])) return
  if (!guard(req, res)) return
  return handlePost(req, res)
})
