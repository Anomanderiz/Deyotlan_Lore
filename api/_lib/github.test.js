/**
 * Tests for the GitHub storage backend against a stubbed `fetch`.
 *
 * This is the one module that cannot be exercised for real without a personal access
 * token, so its sequencing, encoding and failure handling are pinned here instead.
 * The behaviours that matter most are the ones that would silently corrupt data or
 * send someone debugging in the wrong direction:
 *
 *   - tree paths must be raw UTF-8, never URL-encoded (this is the whole reason the
 *     Git Data API is used in preference to the Contents API)
 *   - Contents API reads must encode per segment
 *   - the branch is only ever fast-forwarded (`force: false`)
 *   - a rejected token must be reported as a rejected token
 */
import test, { describe, beforeEach, afterEach } from "node:test"
import assert from "node:assert"
import { headSha, readFile, listDir, exists, commitFiles } from "./github.js"

const LEGACY = "content/Five Banners Burning Campaign/Session Notes/Session 5; 2-09-2026.md"

const HEAD_SHA = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
const BASE_TREE = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
const BLOB_SHA = "cccccccccccccccccccccccccccccccccccccccc"
const TREE_SHA = "dddddddddddddddddddddddddddddddddddddddd"
const NEW_COMMIT = "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee"

let realFetch
let calls

/**
 * Install a scripted fetch. `routes` maps "METHOD /path" to either a response
 * descriptor or a function of (callIndexForThatRoute) returning one, so a route can
 * behave differently on retry.
 */
function stubFetch(routes) {
  const perRoute = new Map()
  globalThis.fetch = async (url, init = {}) => {
    const method = init.method ?? "GET"
    const path = String(url).replace("https://api.github.com", "")
    const key = `${method} ${path}`
    const body = init.body ? JSON.parse(init.body) : undefined
    calls.push({ method, path, body, headers: init.headers })

    let route = routes[key]
    if (!route) {
      // Allow matching without the query string.
      route = routes[`${method} ${path.split("?")[0]}`]
    }
    if (!route) {
      return new Response(JSON.stringify({ message: "no stub" }), { status: 599 })
    }

    const n = perRoute.get(key) ?? 0
    perRoute.set(key, n + 1)
    const resolved = typeof route === "function" ? route(n) : route

    return new Response(resolved.body === undefined ? "" : JSON.stringify(resolved.body), {
      status: resolved.status ?? 200,
    })
  }
}

/** The five calls a successful single-file commit makes, in order. */
function happyPathRoutes(overrides = {}) {
  return {
    "GET /repos/o/r/git/ref/heads/v5": { body: { object: { sha: HEAD_SHA } } },
    [`GET /repos/o/r/git/commits/${HEAD_SHA}`]: { body: { tree: { sha: BASE_TREE } } },
    "POST /repos/o/r/git/blobs": { body: { sha: BLOB_SHA } },
    "POST /repos/o/r/git/trees": { body: { sha: TREE_SHA } },
    "POST /repos/o/r/git/commits": { body: { sha: NEW_COMMIT } },
    "PATCH /repos/o/r/git/refs/heads/v5": { status: 200, body: {} },
    ...overrides,
  }
}

const find = (method, pathFragment) =>
  calls.find((c) => c.method === method && c.path.includes(pathFragment))

beforeEach(() => {
  realFetch = globalThis.fetch
  calls = []
  process.env.GITHUB_TOKEN = "test-token"
  process.env.GITHUB_REPO = "o/r"
  process.env.GITHUB_BRANCH = "v5"
})

afterEach(() => {
  globalThis.fetch = realFetch
  delete process.env.GITHUB_TOKEN
  delete process.env.GITHUB_REPO
  delete process.env.GITHUB_BRANCH
})

describe("configuration", () => {
  test("a missing token is reported as misconfiguration, not a GitHub error", async () => {
    delete process.env.GITHUB_TOKEN
    stubFetch({})
    await assert.rejects(
      () => headSha(),
      (err) => err.code === "misconfigured",
    )
  })

  test("a missing repo is reported as misconfiguration", async () => {
    delete process.env.GITHUB_REPO
    stubFetch({})
    await assert.rejects(
      () => headSha(),
      (err) => err.code === "misconfigured",
    )
  })

  test("requests carry the documented auth and API-version headers", async () => {
    stubFetch(happyPathRoutes())
    await headSha()
    const h = calls[0].headers
    assert.equal(h.Authorization, "Bearer test-token")
    assert.equal(h.Accept, "application/vnd.github+json")
    assert.equal(h["X-GitHub-Api-Version"], "2022-11-28")
    assert.ok(h["User-Agent"])
  })
})

describe("reads", () => {
  test("a missing file is null rather than an error", async () => {
    stubFetch({ "GET /repos/o/r/contents/content/nope.md": { status: 404, body: {} } })
    assert.equal(await readFile("content/nope.md"), null)
  })

  test("content is base64-decoded", async () => {
    stubFetch({
      "GET /repos/o/r/contents/content/a.md": {
        body: { content: Buffer.from("hello wiki", "utf8").toString("base64"), sha: "s1" },
      },
    })
    const file = await readFile("content/a.md")
    assert.equal(file.content, "hello wiki")
    assert.equal(file.sha, "s1")
  })

  test("read paths are URL-encoded per segment", async () => {
    // The Contents API puts the path in the URL, so the spaces and the semicolon in
    // the legacy filename must be encoded -- but the separators must not be.
    stubFetch({ "GET /repos/o/r/contents/*": { status: 404, body: {} } })
    globalThis.fetch = async (url) => {
      calls.push({ method: "GET", path: String(url) })
      return new Response(JSON.stringify({}), { status: 404 })
    }
    await readFile(LEGACY)
    const url = calls[0].path
    assert.ok(url.includes("Session%205%3B%202-09-2026.md"), url)
    assert.ok(url.includes("Five%20Banners%20Burning%20Campaign"), url)
    assert.ok(!url.includes("%2F"), "path separators must not be encoded")
  })

  test("listDir returns entries, and [] for a missing directory", async () => {
    stubFetch({
      "GET /repos/o/r/contents/content/Notes": {
        body: [
          { name: "a.md", type: "file" },
          { name: "sub", type: "dir" },
        ],
      },
    })
    assert.deepEqual(await listDir("content/Notes"), [
      { name: "a.md", type: "file" },
      { name: "sub", type: "dir" },
    ])

    calls = []
    stubFetch({ "GET /repos/o/r/contents/content/Gone": { status: 404, body: {} } })
    assert.deepEqual(await listDir("content/Gone"), [])
  })

  test("listDir on a file (object, not array) yields []", async () => {
    stubFetch({ "GET /repos/o/r/contents/content/a.md": { body: { name: "a.md" } } })
    assert.deepEqual(await listDir("content/a.md"), [])
  })

  test("exists reflects presence", async () => {
    stubFetch({ "GET /repos/o/r/contents/content/a.md": { body: { content: "", sha: "s" } } })
    assert.equal(await exists("content/a.md"), true)
  })
})

describe("commitFiles: the happy path", () => {
  test("performs ref, commit, blob, tree, commit, patch in that order", async () => {
    stubFetch(happyPathRoutes())
    const result = await commitFiles({
      files: [{ path: "content/a.md", content: "x" }],
      message: "m",
    })

    assert.equal(result.commit, NEW_COMMIT)
    assert.deepEqual(
      calls.map((c) => `${c.method} ${c.path.split("?")[0].replace("/repos/o/r/", "")}`),
      [
        "GET git/ref/heads/v5",
        `GET git/commits/${HEAD_SHA}`,
        "POST git/blobs",
        "POST git/trees",
        "POST git/commits",
        "PATCH git/refs/heads/v5",
      ],
    )
  })

  test("file content is sent base64-encoded", async () => {
    stubFetch(happyPathRoutes())
    await commitFiles({ files: [{ path: "content/a.md", content: "héllo" }], message: "m" })
    const blob = find("POST", "git/blobs")
    assert.equal(blob.body.encoding, "base64")
    assert.equal(Buffer.from(blob.body.content, "base64").toString("utf8"), "héllo")
  })

  test("the new tree is based on the current commit tree", async () => {
    stubFetch(happyPathRoutes())
    await commitFiles({ files: [{ path: "content/a.md", content: "x" }], message: "m" })
    assert.equal(find("POST", "git/trees").body.base_tree, BASE_TREE)
  })

  test("the commit parents the current head and carries the message", async () => {
    stubFetch(happyPathRoutes())
    await commitFiles({ files: [{ path: "content/a.md", content: "x" }], message: "the message" })
    const commit = find("POST", "git/commits")
    assert.deepEqual(commit.body.parents, [HEAD_SHA])
    assert.equal(commit.body.message, "the message")
    assert.equal(commit.body.tree, TREE_SHA)
  })

  test("THE IMPORTANT ONE: tree paths are raw UTF-8, never URL-encoded", async () => {
    // This is the entire reason the Git Data API is used rather than the Contents
    // API. If this ever regresses, files land at literally-encoded paths such as
    // "Session%205%3B...md" and the site breaks in a very confusing way.
    stubFetch(happyPathRoutes())
    await commitFiles({ files: [{ path: LEGACY, content: "x" }], message: "m" })
    const entry = find("POST", "git/trees").body.tree[0]
    assert.equal(entry.path, LEGACY)
    assert.ok(!entry.path.includes("%"), entry.path)
    assert.equal(entry.mode, "100644")
    assert.equal(entry.type, "blob")
  })

  test("the branch is only ever fast-forwarded", async () => {
    stubFetch(happyPathRoutes())
    await commitFiles({ files: [{ path: "content/a.md", content: "x" }], message: "m" })
    assert.equal(find("PATCH", "git/refs").body.force, false)
    assert.equal(find("PATCH", "git/refs").body.sha, NEW_COMMIT)
  })

  test("multiple files are committed atomically, as one tree and one commit", async () => {
    stubFetch(happyPathRoutes())
    await commitFiles({
      files: [
        { path: "content/a.md", content: "one" },
        { path: "quartz/static/nav.json", content: "{}" },
      ],
      message: "m",
    })
    assert.equal(calls.filter((c) => c.path.includes("git/blobs")).length, 2)
    assert.equal(calls.filter((c) => c.path.includes("git/trees")).length, 1)
    assert.equal(
      calls.filter((c) => c.path.includes("git/commits") && c.method === "POST").length,
      1,
    )
    assert.equal(find("POST", "git/trees").body.tree.length, 2)
  })

  test("a null content deletes the path via a null tree sha", async () => {
    stubFetch(happyPathRoutes())
    await commitFiles({ files: [{ path: "content/gone.md", content: null }], message: "m" })
    assert.equal(
      calls.filter((c) => c.path.includes("git/blobs")).length,
      0,
      "no blob for a delete",
    )
    assert.deepEqual(find("POST", "git/trees").body.tree[0], {
      path: "content/gone.md",
      mode: "100644",
      type: "blob",
      sha: null,
    })
  })

  test("an empty file list is refused", async () => {
    stubFetch(happyPathRoutes())
    await assert.rejects(
      () => commitFiles({ files: [], message: "m" }),
      (err) => err.status === 400,
    )
  })
})

describe("commitFiles: conflicts and retries", () => {
  test("a stale expectedHeadSha conflicts before anything is written", async () => {
    stubFetch(happyPathRoutes())
    await assert.rejects(
      () =>
        commitFiles({
          files: [{ path: "content/a.md", content: "x" }],
          message: "m",
          expectedHeadSha: "something-older",
        }),
      (err) => {
        assert.equal(err.status, 409)
        assert.equal(err.code, "conflict")
        return true
      },
    )
    assert.equal(calls.filter((c) => c.method === "POST").length, 0, "nothing should be written")
  })

  test("a matching expectedHeadSha proceeds", async () => {
    stubFetch(happyPathRoutes())
    const r = await commitFiles({
      files: [{ path: "content/a.md", content: "x" }],
      message: "m",
      expectedHeadSha: HEAD_SHA,
    })
    assert.equal(r.commit, NEW_COMMIT)
  })

  test("a 422 fast-forward failure retries from the top, re-reading the base tree", async () => {
    // Someone else pushed mid-sequence. Retrying re-reads base_tree, so a commit
    // touching different files merges cleanly instead of clobbering.
    stubFetch(
      happyPathRoutes({
        "PATCH /repos/o/r/git/refs/heads/v5": (n) =>
          n === 0
            ? { status: 422, body: { message: "not a fast forward" } }
            : { status: 200, body: {} },
      }),
    )
    const r = await commitFiles({ files: [{ path: "content/a.md", content: "x" }], message: "m" })
    assert.equal(r.commit, NEW_COMMIT)
    assert.equal(
      calls.filter((c) => c.path.includes("git/ref/heads")).length,
      2,
      "should re-read the ref",
    )
    assert.equal(calls.filter((c) => c.method === "PATCH").length, 2)
  })

  test("a persistent 422 gives up as a conflict rather than looping", async () => {
    stubFetch(
      happyPathRoutes({
        "PATCH /repos/o/r/git/refs/heads/v5": {
          status: 422,
          body: { message: "not a fast forward" },
        },
      }),
    )
    await assert.rejects(
      () => commitFiles({ files: [{ path: "content/a.md", content: "x" }], message: "m" }),
      (err) => err.status === 409,
    )
    assert.equal(calls.filter((c) => c.method === "PATCH").length, 3, "capped at three attempts")
  })

  test("with expectedHeadSha a 422 conflicts immediately, without retrying", async () => {
    // The caller asked for compare-and-swap semantics, so silently retrying would
    // defeat the point.
    stubFetch(
      happyPathRoutes({
        "PATCH /repos/o/r/git/refs/heads/v5": {
          status: 422,
          body: { message: "not a fast forward" },
        },
      }),
    )
    await assert.rejects(
      () =>
        commitFiles({
          files: [{ path: "content/a.md", content: "x" }],
          message: "m",
          expectedHeadSha: HEAD_SHA,
        }),
      (err) => err.status === 409,
    )
    assert.equal(calls.filter((c) => c.method === "PATCH").length, 1)
  })
})

describe("commitFiles: failures are legible", () => {
  for (const status of [401, 403]) {
    test(`a ${status} is reported as a rejected token, not a generic failure`, async () => {
      // An expired fine-grained PAT is the single most likely cause of a sudden
      // total failure; "something went wrong" would send you looking elsewhere.
      stubFetch({
        "GET /repos/o/r/git/ref/heads/v5": { status, body: { message: "Bad credentials" } },
      })
      await assert.rejects(
        () => commitFiles({ files: [{ path: "content/a.md", content: "x" }], message: "m" }),
        (err) => {
          assert.equal(err.code, "github_auth")
          assert.match(err.message, /token/i)
          assert.match(err.message, /expired/i)
          return true
        },
      )
    })
  }

  test("a failure creating the tree surfaces as a github error", async () => {
    stubFetch(happyPathRoutes({ "POST /repos/o/r/git/trees": { status: 500, body: {} } }))
    await assert.rejects(
      () => commitFiles({ files: [{ path: "content/a.md", content: "x" }], message: "m" }),
      (err) => err.code === "github",
    )
  })

  test("an unreadable branch surfaces as a github error naming the branch", async () => {
    stubFetch({ "GET /repos/o/r/git/ref/heads/v5": { status: 404, body: {} } })
    await assert.rejects(
      () => headSha(),
      (err) => {
        assert.equal(err.code, "github")
        assert.match(err.message, /v5/)
        return true
      },
    )
  })
})
