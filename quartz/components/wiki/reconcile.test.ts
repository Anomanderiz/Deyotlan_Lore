import test, { describe } from "node:test"
import assert from "node:assert"
import fs from "node:fs"
import path from "node:path"
import { reconcile, displaySlug, urlForSlug, UNFILED_GROUP_ID } from "./reconcile"
import type { ContentDetails, NavManifest } from "./reconcile"

const index = (slugs: string[]): Record<string, ContentDetails> =>
  Object.fromEntries(slugs.map((s) => [s, { slug: s, title: s.split("/").pop() ?? s }]))

const allSlugs = (groups: ReturnType<typeof reconcile>) =>
  groups.flatMap((g) => g.items.map((i) => i.slug))

describe("displaySlug", () => {
  test("folder index pages resolve to the folder URL", () => {
    assert.equal(displaySlug("a/b/index"), "a/b")
    assert.equal(displaySlug("a/b"), "a/b")
    assert.equal(displaySlug("index"), "index")
  })
})

describe("urlForSlug", () => {
  test("encodes each segment, so awkward legacy filenames survive", () => {
    assert.equal(
      urlForSlug("five-banners-burning-campaign/session-notes/session-5;-2-09-2026"),
      "/five-banners-burning-campaign/session-notes/session-5%3B-2-09-2026",
    )
  })

  test("does not encode the separators themselves", () => {
    assert.equal(urlForSlug("a/b/c"), "/a/b/c")
  })

  test("honours a base path", () => {
    assert.equal(urlForSlug("a/b", "/wiki"), "/wiki/a/b")
  })
})

describe("reconcile without a manifest", () => {
  test("falls back to a folder tree rather than rendering nothing", () => {
    const groups = reconcile(index(["a/one", "a/two", "b/three", "solo"]), null)
    assert.ok(groups.length > 0)
    assert.deepEqual(allSlugs(groups).sort(), ["a/one", "a/two", "b/three", "solo"])
  })

  test("excludes generated tag pages", () => {
    const groups = reconcile(index(["a/one", "tags/lore", "tags"]), null)
    assert.deepEqual(allSlugs(groups), ["a/one"])
  })
})

describe("reconcile with a manifest", () => {
  const manifest: NavManifest = {
    version: 1,
    groups: [
      { id: "g1", label: "Curated", items: [{ slug: "z/last" }, { slug: "a/first" }] },
      { id: "g2", label: "Hinted", folderHints: ["notes"], autoSort: "title" },
    ],
    hidden: ["secret"],
    fallbackGroupLabel: "Unfiled",
  }

  test("curated items keep manifest order, not alphabetical order", () => {
    const groups = reconcile(index(["a/first", "z/last"]), manifest)
    assert.deepEqual(
      groups.find((g) => g.id === "g1")!.items.map((i) => i.slug),
      ["z/last", "a/first"],
    )
  })

  test("a page in a group renders there regardless of its folder", () => {
    // "z/last" lives in folder z but is curated into g1: groups are not folders.
    const groups = reconcile(index(["z/last"]), manifest)
    assert.equal(groups.find((g) => g.id === "g1")!.items[0].slug, "z/last")
  })

  test("folder hints auto-place pages the manifest never mentions", () => {
    const groups = reconcile(index(["notes/one", "notes/two"]), manifest)
    assert.deepEqual(
      groups.find((g) => g.id === "g2")!.items.map((i) => i.slug),
      ["notes/one", "notes/two"],
    )
  })

  test("unclaimed pages land in the fallback group instead of vanishing", () => {
    const groups = reconcile(index(["brand/new/page"]), manifest)
    const unfiled = groups.find((g) => g.id === UNFILED_GROUP_ID)
    assert.ok(unfiled, "expected a fallback group")
    assert.deepEqual(
      unfiled!.items.map((i) => i.slug),
      ["brand/new/page"],
    )
  })

  test("hidden slugs are suppressed", () => {
    const groups = reconcile(index(["secret", "notes/one"]), manifest)
    assert.ok(!allSlugs(groups).includes("secret"))
  })

  test("manifest entries for deleted pages are dropped silently", () => {
    // g1 references a/first and z/last; only one still exists.
    const groups = reconcile(index(["a/first"]), manifest)
    assert.deepEqual(
      groups.find((g) => g.id === "g1")!.items.map((i) => i.slug),
      ["a/first"],
    )
  })

  test("a group that ends up empty is not rendered", () => {
    const groups = reconcile(index(["notes/one"]), manifest)
    assert.ok(!groups.some((g) => g.id === "g1"))
  })

  test("an item label overrides the page title for nav display only", () => {
    const m: NavManifest = {
      version: 1,
      groups: [{ id: "g", label: "G", items: [{ slug: "a/b", label: "Nicer Name" }] }],
    }
    const groups = reconcile({ "a/b": { slug: "a/b", title: "Ugly_Title" } }, m)
    assert.equal(groups[0].items[0].label, "Nicer Name")
  })

  test("date-desc sorting puts the newest session first", () => {
    const m: NavManifest = {
      version: 1,
      groups: [{ id: "s", label: "Sessions", folderHints: ["s"], autoSort: "date-desc" }],
    }
    const idx: Record<string, ContentDetails> = {
      "s/one": { slug: "s/one", title: "One", sessionDate: "2026-01-01" },
      "s/two": { slug: "s/two", title: "Two", sessionDate: "2026-09-01" },
      "s/three": { slug: "s/three", title: "Three", sessionDate: "2026-05-01" },
    }
    assert.deepEqual(
      reconcile(idx, m)[0].items.map((i) => i.slug),
      ["s/two", "s/three", "s/one"],
    )
  })

  test("date-desc uses the supplied dates map, not the index", () => {
    // The generated content index carries no date fields at all, so the dates map
    // from /static/wiki-meta.json is the only thing that makes this sort work.
    const m: NavManifest = {
      version: 1,
      groups: [{ id: "s", label: "Sessions", folderHints: ["s"], autoSort: "date-desc" }],
    }
    const idx = index(["s/session-05-old", "s/session-06-new"])
    // Without dates it falls back to title order, which is alphabetical.
    assert.deepEqual(
      reconcile(idx, m)[0].items.map((i) => i.slug),
      ["s/session-05-old", "s/session-06-new"],
    )
    // With dates the newest comes first.
    const dates = { "s/session-05-old": "2026-01-01", "s/session-06-new": "2026-09-25" }
    assert.deepEqual(
      reconcile(idx, m, "", dates)[0].items.map((i) => i.slug),
      ["s/session-06-new", "s/session-05-old"],
    )
  })

  test("the longest folder hint wins, so nesting is not swallowed", () => {
    const m: NavManifest = {
      version: 1,
      groups: [
        { id: "outer", label: "Outer", folderHints: ["a"] },
        { id: "inner", label: "Inner", folderHints: ["a/b"] },
      ],
    }
    const groups = reconcile(index(["a/x", "a/b/y"]), m)
    assert.deepEqual(
      groups.find((g) => g.id === "inner")!.items.map((i) => i.slug),
      ["a/b/y"],
    )
    assert.deepEqual(
      groups.find((g) => g.id === "outer")!.items.map((i) => i.slug),
      ["a/x"],
    )
  })

  test("no page is ever listed twice", () => {
    const m: NavManifest = {
      version: 1,
      groups: [
        { id: "g1", label: "One", items: [{ slug: "notes/one" }] },
        { id: "g2", label: "Two", folderHints: ["notes"] },
      ],
    }
    const slugs = allSlugs(reconcile(index(["notes/one", "notes/two"]), m))
    assert.equal(new Set(slugs).size, slugs.length, `duplicates in ${slugs.join(", ")}`)
  })
})

/**
 * The parity audit the nav replacement has to satisfy: against this project's real
 * content index and real manifest, every navigable page appears exactly once.
 */
describe("parity against the real site data", () => {
  const root = path.resolve(import.meta.dirname, "../../..")
  const indexPath = path.join(root, "public/static/contentIndex.json")
  const manifestPath = path.join(root, "quartz/static/nav.json")

  const available = fs.existsSync(indexPath) && fs.existsSync(manifestPath)

  test("every navigable page appears exactly once", { skip: !available }, () => {
    const raw = JSON.parse(fs.readFileSync(indexPath, "utf8"))
    const idx: Record<string, ContentDetails> = raw.content ?? raw
    const manifest: NavManifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"))

    const expected = Object.keys(idx)
      .filter((s) => s !== "tags" && !s.startsWith("tags/"))
      .filter((s) => !(manifest.hidden ?? []).includes(s))
      .sort()

    const metaPath = path.join(root, "public/static/wiki-meta.json")
    const dates = fs.existsSync(metaPath)
      ? (JSON.parse(fs.readFileSync(metaPath, "utf8")).dates ?? {})
      : {}
    const rendered = allSlugs(reconcile(idx, manifest, "", dates)).sort()

    assert.deepEqual(
      rendered,
      expected,
      `nav does not match the index.\n  missing: ${expected.filter((s) => !rendered.includes(s)).join(", ") || "none"}\n  extra:   ${rendered.filter((s) => !expected.includes(s)).join(", ") || "none"}`,
    )
    assert.equal(new Set(rendered).size, rendered.length, "a page is listed more than once")
  })

  test("a malformed manifest degrades to the folder tree", { skip: !available }, () => {
    const raw = JSON.parse(fs.readFileSync(indexPath, "utf8"))
    const idx: Record<string, ContentDetails> = raw.content ?? raw
    const groups = reconcile(idx, null)
    assert.ok(groups.length > 0, "fallback rendered nothing")
    const expected = Object.keys(idx).filter((s) => s !== "tags" && !s.startsWith("tags/"))
    assert.equal(allSlugs(groups).length, expected.length)
  })
})
