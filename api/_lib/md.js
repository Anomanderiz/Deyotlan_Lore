/**
 * Markdown and path handling shared by every write endpoint.
 *
 * Uses the `yaml` package, which is already a direct dependency and is the same
 * parser Quartz itself uses -- so frontmatter written here round-trips through the
 * build exactly as authored.
 */
import YAML from "yaml"
import nodePath from "node:path"
import { HttpError } from "./http.js"

export const CONTENT_ROOT = "content"

/** Tags applied to every quick-add session note. */
export const SESSION_DEFAULT_TAGS = ["session-notes", "five-banners-burning"]

export const SESSION_NOTES_DIR = "content/Five Banners Burning Campaign/Session Notes"

// --- filenames ---------------------------------------------------------------

// Reserved on Windows, where this repo is cloned and developed.
const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i

/**
 * Turn a human title into a safe filename stem.
 *
 * Note the deliberate asymmetry with `validateRepoPath`: this generator never
 * produces spaces, semicolons or uppercase, while the validator tolerates all three
 * so that pre-existing files such as `Session 5; 2-09-2026.md` remain editable.
 * Lowercasing also sidesteps the "works on Windows, 404s on Linux" class of bug.
 */
export function safeName(title) {
  let s = String(title ?? "")
    .normalize("NFKC")
    .normalize("NFD")
    .replace(/\p{M}/gu, "") // strip diacritics
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")

  if (s.length > 80) {
    const cut = s.slice(0, 80)
    const lastDash = cut.lastIndexOf("-")
    s = lastDash > 40 ? cut.slice(0, lastDash) : cut
    s = s.replace(/-$/, "")
  }

  if (s === "" || WINDOWS_RESERVED.test(s)) return s === "" ? "untitled" : `${s}-page`
  return s
}

/**
 * Validate an assembled repository path before any write.
 *
 * Tolerant of the characters existing files already use; strict about everything
 * that could escape `content/` or break on a case-sensitive filesystem.
 */
export function validateRepoPath(repoPath) {
  const p = String(repoPath ?? "")

  if (p.length === 0 || p.length > 200) {
    throw new HttpError(400, "bad_path", "Path must be between 1 and 200 characters.")
  }
  if (p.includes("\\")) {
    throw new HttpError(400, "bad_path", "Path must use forward slashes.")
  }
  if (p.startsWith("/") || p.includes("//") || p.includes("..")) {
    throw new HttpError(400, "bad_path", "Path must be relative and contain no '..'.")
  }
  if (!p.startsWith(CONTENT_ROOT + "/")) {
    throw new HttpError(400, "bad_path", `Path must start with ${CONTENT_ROOT}/.`)
  }
  if (!p.endsWith(".md")) {
    throw new HttpError(400, "bad_path", "Path must end with .md.")
  }
  if (!/^[A-Za-z0-9 _\-.,;'()/]+$/.test(p)) {
    throw new HttpError(400, "bad_path", "Path contains unsupported characters.")
  }

  const segments = p.split("/")
  for (const seg of segments) {
    if (seg === "" || seg.startsWith(".")) {
      throw new HttpError(400, "bad_path", "Path segments must not be empty or start with a dot.")
    }
    const stem = seg.replace(/\.md$/, "")
    if (WINDOWS_RESERVED.test(stem)) {
      throw new HttpError(400, "bad_path", `"${seg}" is a reserved filename on Windows.`)
    }
  }

  // Belt and braces: normalising must not move the path out of content/.
  const normalised = nodePath.posix.normalize(p)
  if (normalised !== p || !normalised.startsWith(CONTENT_ROOT + "/")) {
    throw new HttpError(400, "bad_path", "Path does not normalise to a location inside content/.")
  }

  return p
}

// --- body normalisation ------------------------------------------------------

export function normalizeBody(text) {
  let s = String(text ?? "")
  if (s.charCodeAt(0) === 0xfeff) s = s.slice(1) // strip BOM
  s = s.replace(/\r\n?/g, "\n")
  // Leading blank lines are stripped as well as trailing ones. Without this, every
  // body carries the blank line that followed the closing `---`, and a paste that
  // begins with a blank line would not be recognised as having frontmatter at all.
  // Only newlines are removed, never leading spaces, which may be a code block.
  s = s.replace(/^\n+/, "").replace(/\n+$/, "")
  return s
}

// --- frontmatter -------------------------------------------------------------

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/

/**
 * Split a document into frontmatter data and body. Returns `data: null` when there
 * is no frontmatter block, which callers distinguish from an empty one.
 */
export function parseDocument(raw) {
  const text = normalizeBody(raw)
  const match = text.match(FRONTMATTER_RE)
  if (!match) return { data: null, body: text }

  let data
  try {
    data = YAML.parse(match[1])
  } catch (err) {
    throw new HttpError(
      400,
      "bad_frontmatter",
      `The frontmatter block is not valid YAML: ${err.message}`,
    )
  }
  if (data !== null && (typeof data !== "object" || Array.isArray(data))) {
    throw new HttpError(400, "bad_frontmatter", "Frontmatter must be a YAML mapping.")
  }
  return { data: data ?? {}, body: normalizeBody(text.slice(match[0].length)) }
}

export function serializeDocument(data, body) {
  const yaml = YAML.stringify(data, {
    // Never fold a long title across lines.
    lineWidth: 0,
    // Deliberately NOT forcing a quote style. The library quotes only where the
    // value needs it, which both round-trips exactly and matches the style of the
    // files already in content/ -- unquoted ISO dates, plain tag lists -- so admin
    // edits do not produce noisy diffs against hand-authored pages.
  })
  return `---\n${yaml}---\n\n${normalizeBody(body)}\n`
}

/**
 * Merge user-supplied frontmatter over a template.
 *
 * The user wins on everything except the protected keys: `publish` and `modified` are
 * always the server's, and tags are union-merged so a template tag cannot be dropped
 * by accident.
 */
export function mergeFrontmatter(template, user) {
  const merged = { ...template, ...(user ?? {}) }

  if (Object.prototype.hasOwnProperty.call(template, "publish")) {
    merged.publish = template.publish
  }
  if (Object.prototype.hasOwnProperty.call(template, "modified")) {
    merged.modified = template.modified
  }

  const templateTags = toTagArray(template.tags)
  const userTags = toTagArray(user?.tags)
  if (templateTags.length > 0 || userTags.length > 0) {
    merged.tags = [...new Set([...templateTags, ...userTags])]
  }

  return merged
}

export function toTagArray(value) {
  if (value == null) return []
  if (Array.isArray(value)) return value.map((t) => String(t).trim()).filter(Boolean)
  return String(value)
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean)
}

// --- title derivation --------------------------------------------------------

/**
 * Derive a title from a body that has no frontmatter.
 *
 * A leading `# Heading` is consumed rather than merely read: the site renders the
 * page title from frontmatter via `@quartz-community/article-title`, so leaving the
 * H1 in place would show it twice.
 */
export function deriveTitle(body, fallback) {
  const text = normalizeBody(body)
  const lines = text.split("\n")

  let i = 0
  while (i < lines.length && lines[i].trim() === "") i++

  if (i < lines.length) {
    const h1 = lines[i].match(/^#\s+(.+?)\s*$/)
    if (h1) {
      const rest = lines.slice(i + 1).join("\n")
      return { title: h1[1].trim(), body: normalizeBody(rest) }
    }
    const first = lines[i].trim()
    if (first.length > 0) {
      const plain = first
        .replace(/^[#>*\-+\s]+/, "")
        .replace(/[*_`]/g, "")
        .trim()
      if (plain.length > 0) {
        return { title: plain.length > 80 ? plain.slice(0, 80).trimEnd() : plain, body: text }
      }
    }
  }

  return { title: fallback, body: text }
}

// --- dates -------------------------------------------------------------------

/**
 * Today's date as YYYY-MM-DD in the relevant timezone.
 *
 * Timezone matters more than it looks: at a table at 11pm, UTC would file the note
 * under tomorrow.
 */
export function localDateISO(timeZone) {
  const tz = timeZone || process.env.SESSION_TZ || "UTC"
  try {
    const fmt = new Intl.DateTimeFormat("en-CA", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    })
    return fmt.format(new Date()) // en-CA yields YYYY-MM-DD
  } catch {
    return new Date().toISOString().slice(0, 10)
  }
}

export function localTimeHHMM(timeZone) {
  const tz = timeZone || process.env.SESSION_TZ || "UTC"
  try {
    return new Intl.DateTimeFormat("en-GB", {
      timeZone: tz,
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(new Date())
  } catch {
    return new Date().toISOString().slice(11, 16)
  }
}
