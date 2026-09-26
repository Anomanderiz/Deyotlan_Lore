/**
 * Storage backend selector.
 *
 * One interface, two implementations:
 *
 *   readFile(repoPath)   -> { content, sha } | null
 *   listDir(repoPath)    -> [{ name, type }]
 *   exists(repoPath)     -> boolean
 *   headSha()            -> string
 *   commitFiles({ files, message, expectedHeadSha }) -> { commit }
 *
 * `repoPath` is always POSIX and repository-relative (`content/Foo/Bar.md`). Never
 * pass a `path.join()` result in: on Windows that produces backslashes, which the
 * GitHub API treats as part of the filename. Only the fs backend converts separators,
 * and it does so at its own boundary.
 *
 * `files` entries are `{ path, content }`, where a null `content` means delete.
 */
const BACKEND = process.env.DEYOTLAN_STORE ?? (process.env.VERCEL ? "github" : "fs")

let impl = null

async function backend() {
  if (impl) return impl
  if (BACKEND === "github") {
    impl = await import("./github.js")
  } else if (BACKEND === "fs") {
    impl = await import("./fsstore.js")
  } else {
    throw new Error(`Unknown DEYOTLAN_STORE backend: ${BACKEND}`)
  }
  return impl
}

export function backendName() {
  return BACKEND
}

/** True when writes are local and therefore visible immediately, with no deploy. */
export function isLocalBackend() {
  return BACKEND === "fs"
}

export async function readFile(repoPath) {
  return (await backend()).readFile(repoPath)
}

export async function listDir(repoPath) {
  return (await backend()).listDir(repoPath)
}

export async function exists(repoPath) {
  return (await backend()).exists(repoPath)
}

export async function headSha() {
  return (await backend()).headSha()
}

export async function commitFiles(args) {
  return (await backend()).commitFiles(args)
}
