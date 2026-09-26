/**
 * Local-filesystem storage backend.
 *
 * Writes straight into the working tree, which means `quartz build --serve`'s chokidar
 * watcher picks the change up and hot-reloads the browser in well under a second. The
 * local authoring loop is genuinely faster than production, where every write is a
 * commit and a full rebuild.
 *
 * Shas are meaningless here, so every sha is the literal string "local" and
 * `expectedHeadSha` checks are no-ops. Callers must not infer anything from them.
 */
import fs from "node:fs/promises"
import nodePath from "node:path"
import { HttpError } from "./http.js"

const LOCAL_SHA = "local"

function repoRoot() {
  return nodePath.resolve(process.env.DEYOTLAN_REPO_ROOT ?? process.cwd())
}

/**
 * Resolve a POSIX repo-relative path to an absolute local path, refusing anything
 * that escapes the repository. This is the boundary where forward slashes become
 * platform separators -- everything above this line stays POSIX.
 */
function resolveLocal(repoPath) {
  const root = repoRoot()
  const normalised = nodePath.posix.normalize(repoPath)
  if (normalised.startsWith("..") || nodePath.posix.isAbsolute(normalised)) {
    throw new HttpError(400, "bad_path", `Path escapes the repository: ${repoPath}`)
  }
  const abs = nodePath.resolve(root, ...normalised.split("/"))
  const rel = nodePath.relative(root, abs)
  if (rel.startsWith("..") || nodePath.isAbsolute(rel)) {
    throw new HttpError(400, "bad_path", `Path escapes the repository: ${repoPath}`)
  }
  return abs
}

export async function headSha() {
  return LOCAL_SHA
}

export async function readFile(repoPath) {
  try {
    const content = await fs.readFile(resolveLocal(repoPath), "utf8")
    return { content, sha: LOCAL_SHA }
  } catch (err) {
    if (err.code === "ENOENT") return null
    throw err
  }
}

export async function listDir(repoPath) {
  try {
    const entries = await fs.readdir(resolveLocal(repoPath), { withFileTypes: true })
    return entries.map((e) => ({
      name: e.name,
      type: e.isDirectory() ? "dir" : "file",
    }))
  } catch (err) {
    if (err.code === "ENOENT") return []
    throw err
  }
}

export async function exists(repoPath) {
  try {
    await fs.access(resolveLocal(repoPath))
    return true
  } catch {
    return false
  }
}

/**
 * Write every file, then report a single synthetic commit.
 *
 * This is not atomic the way a git commit is -- a crash midway leaves some files
 * written. That is acceptable for a local dev backend and is called out here so the
 * difference from the GitHub backend is not mistaken for a bug.
 */
export async function commitFiles({ files, message }) {
  for (const file of files) {
    const abs = resolveLocal(file.path)
    if (file.content === null) {
      await fs.rm(abs, { force: true })
      continue
    }
    await fs.mkdir(nodePath.dirname(abs), { recursive: true })
    await fs.writeFile(abs, file.content, "utf8")
  }
  console.log(`[admin:fs] ${message} (${files.length} file${files.length === 1 ? "" : "s"})`)
  return { commit: LOCAL_SHA, local: true }
}
