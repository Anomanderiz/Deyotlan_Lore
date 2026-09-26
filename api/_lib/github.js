/**
 * GitHub storage backend, using the Git Data API.
 *
 * The Git Data API is used for *every* write, even single-file ones, for two reasons:
 *
 *  1. A write often touches more than one file (a page plus the nav manifest), so
 *     multi-file atomicity is needed anyway. One code path means one conflict
 *     implementation rather than two.
 *  2. Blob paths in the tree API are raw UTF-8 and are NOT URL-encoded. The Contents
 *     API puts the path in the URL, where the spaces and the semicolon in filenames
 *     like `Session 5; 2-09-2026.md` need per-segment encoding and a `#` would
 *     truncate the path outright. Using trees sidesteps that whole class of bug.
 *
 * Reads use the Contents API, which is simpler -- and there the path *must* be
 * encoded per segment.
 */
import { HttpError } from "./http.js"

const API = "https://api.github.com"

function config() {
  const token = process.env.GITHUB_TOKEN
  const repo = process.env.GITHUB_REPO
  const branch = process.env.GITHUB_BRANCH ?? "v5"
  if (!token) throw new HttpError(500, "misconfigured", "GITHUB_TOKEN is not set.")
  if (!repo) throw new HttpError(500, "misconfigured", "GITHUB_REPO is not set (owner/name).")
  return { token, repo, branch }
}

async function gh(path, { method = "GET", body, token } = {}) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "deyotlan-lore-admin",
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  })

  if (res.status === 401 || res.status === 403) {
    // Distinguish this loudly: an expired fine-grained PAT is the single most likely
    // cause of a sudden total failure, and "something went wrong" would send you
    // looking in the wrong place.
    const detail = await res.text().catch(() => "")
    throw new HttpError(
      502,
      "github_auth",
      "GitHub rejected the token - it has probably expired or lost repository access.",
      { githubStatus: res.status, detail: detail.slice(0, 300) },
    )
  }

  let payload = null
  const text = await res.text()
  if (text) {
    try {
      payload = JSON.parse(text)
    } catch {
      payload = null
    }
  }
  return { status: res.status, ok: res.ok, data: payload }
}

/** Encode a repo path for use inside a Contents API URL, segment by segment. */
function encodePath(repoPath) {
  return repoPath.split("/").map(encodeURIComponent).join("/")
}

// --- reads -------------------------------------------------------------------

export async function headSha() {
  const { token, repo, branch } = config()
  const res = await gh(`/repos/${repo}/git/ref/heads/${encodeURIComponent(branch)}`, { token })
  if (!res.ok) {
    throw new HttpError(502, "github", `Could not read branch ${branch} (${res.status}).`)
  }
  return res.data.object.sha
}

export async function readFile(repoPath) {
  const { token, repo, branch } = config()
  const res = await gh(
    `/repos/${repo}/contents/${encodePath(repoPath)}?ref=${encodeURIComponent(branch)}`,
    { token },
  )
  if (res.status === 404) return null
  if (!res.ok) {
    throw new HttpError(502, "github", `Could not read ${repoPath} (${res.status}).`)
  }
  const content = Buffer.from(res.data.content ?? "", "base64").toString("utf8")
  return { content, sha: res.data.sha }
}

export async function exists(repoPath) {
  return (await readFile(repoPath)) !== null
}

export async function listDir(repoPath) {
  const { token, repo, branch } = config()
  const res = await gh(
    `/repos/${repo}/contents/${encodePath(repoPath)}?ref=${encodeURIComponent(branch)}`,
    { token },
  )
  if (res.status === 404) return []
  if (!res.ok) {
    throw new HttpError(502, "github", `Could not list ${repoPath} (${res.status}).`)
  }
  if (!Array.isArray(res.data)) return []
  return res.data.map((e) => ({ name: e.name, type: e.type === "dir" ? "dir" : "file" }))
}

// --- writes ------------------------------------------------------------------

const MAX_ATTEMPTS = 3
const RETRY_DELAY_MS = 250

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/**
 * Commit a set of files atomically.
 *
 * `files` is `[{ path, content }]` where a null `content` deletes the file. Paths are
 * raw UTF-8, repository-relative, POSIX.
 *
 * `expectedHeadSha`, when supplied, makes this a compare-and-swap: the commit is
 * refused if the branch has moved since the caller last read it. Without it, a
 * concurrent commit to a *different* file merges cleanly because each retry re-reads
 * `base_tree`; only a same-file race can lose data.
 */
export async function commitFiles({ files, message, expectedHeadSha }) {
  const { token, repo, branch } = config()

  if (!Array.isArray(files) || files.length === 0) {
    throw new HttpError(400, "no_files", "Nothing to commit.")
  }

  let lastError = null

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    // 1. current head
    const refRes = await gh(`/repos/${repo}/git/ref/heads/${encodeURIComponent(branch)}`, { token })
    if (!refRes.ok) {
      throw new HttpError(502, "github", `Could not read branch ${branch} (${refRes.status}).`)
    }
    const currentHead = refRes.data.object.sha

    if (expectedHeadSha && expectedHeadSha !== currentHead) {
      throw new HttpError(409, "conflict", "The wiki changed since you loaded this page.", {
        expected: expectedHeadSha,
        actual: currentHead,
      })
    }

    // 2. base tree
    const commitRes = await gh(`/repos/${repo}/git/commits/${currentHead}`, { token })
    if (!commitRes.ok) {
      throw new HttpError(502, "github", `Could not read commit ${currentHead}.`)
    }
    const baseTree = commitRes.data.tree.sha

    // 3. blobs
    const tree = []
    for (const file of files) {
      if (file.content === null) {
        // A null sha in a tree entry removes the path.
        tree.push({ path: file.path, mode: "100644", type: "blob", sha: null })
        continue
      }
      const blobRes = await gh(`/repos/${repo}/git/blobs`, {
        method: "POST",
        token,
        body: {
          content: Buffer.from(file.content, "utf8").toString("base64"),
          encoding: "base64",
        },
      })
      if (!blobRes.ok) {
        throw new HttpError(502, "github", `Could not create blob for ${file.path}.`)
      }
      tree.push({ path: file.path, mode: "100644", type: "blob", sha: blobRes.data.sha })
    }

    // 4. tree
    const treeRes = await gh(`/repos/${repo}/git/trees`, {
      method: "POST",
      token,
      body: { base_tree: baseTree, tree },
    })
    if (!treeRes.ok) {
      throw new HttpError(502, "github", `Could not create tree (${treeRes.status}).`)
    }

    // 5. commit
    const newCommitRes = await gh(`/repos/${repo}/git/commits`, {
      method: "POST",
      token,
      body: { message, tree: treeRes.data.sha, parents: [currentHead] },
    })
    if (!newCommitRes.ok) {
      throw new HttpError(502, "github", `Could not create commit (${newCommitRes.status}).`)
    }
    const newCommit = newCommitRes.data.sha

    // 6. fast-forward the branch
    const patchRes = await gh(`/repos/${repo}/git/refs/heads/${encodeURIComponent(branch)}`, {
      method: "PATCH",
      token,
      body: { sha: newCommit, force: false },
    })

    if (patchRes.ok) {
      return { commit: newCommit }
    }

    if (patchRes.status === 422) {
      // Someone else pushed between steps 1 and 6. Retrying from the top re-reads
      // base_tree, so a commit touching other files merges cleanly.
      lastError = new HttpError(409, "conflict", "The branch moved while saving.")
      if (expectedHeadSha) throw lastError
      if (attempt < MAX_ATTEMPTS) {
        await sleep(RETRY_DELAY_MS * attempt)
        continue
      }
      throw lastError
    }

    throw new HttpError(502, "github", `Could not update branch (${patchRes.status}).`)
  }

  throw lastError ?? new HttpError(502, "github", "Commit failed.")
}
