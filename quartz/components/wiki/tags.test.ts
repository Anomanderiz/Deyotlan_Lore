import test, { describe } from "node:test"
import assert from "node:assert"
import fs from "node:fs"
import path from "node:path"
import {
  contentEntries,
  tagCounts,
  filterByTags,
  resolvesToPage,
  unresolvedLinks,
  humanise,
  type IndexEntry,
} from "./tags"

const entry = (slug: string, tags: string[] = [], links: string[] = []): IndexEntry => ({
  slug,
  title: slug,
  tags,
  links,
})

describe("contentEntries", () => {
  test("drops generated tag pages", () => {
    const out = contentEntries({
      "a/b": entry("a/b"),
      "tags/lore": entry("tags/lore"),
      tags: entry("tags"),
    })
    assert.deepEqual(
      out.map((e) => e.slug),
      ["a/b"],
    )
  })

  test("backfills the slug from the map key", () => {
    const out = contentEntries({ "a/b": { title: "x" } as IndexEntry })
    assert.equal(out[0].slug, "a/b")
  })
})

describe("tagCounts", () => {
  test("counts pages per tag, most used first", () => {
    const out = tagCounts([entry("1", ["lore", "fey"]), entry("2", ["lore"]), entry("3", ["lore"])])
    assert.deepEqual(out, [
      { tag: "lore", count: 3 },
      { tag: "fey", count: 1 },
    ])
  })

  test("breaks ties alphabetically so the order is stable", () => {
    const out = tagCounts([entry("1", ["zeta", "alpha"])])
    assert.deepEqual(
      out.map((t) => t.tag),
      ["alpha", "zeta"],
    )
  })

  test("untagged pages contribute nothing", () => {
    assert.deepEqual(tagCounts([entry("1")]), [])
  })
})

describe("filterByTags", () => {
  const pages = [
    entry("a", ["lore", "fey"]),
    entry("b", ["lore", "dwarves"]),
    entry("c", ["fey"]),
    entry("d", []),
  ]

  test("no selection returns everything", () => {
    assert.equal(filterByTags(pages, [], "and").length, 4)
  })

  test("AND returns the true intersection", () => {
    assert.deepEqual(
      filterByTags(pages, ["lore", "fey"], "and").map((e) => e.slug),
      ["a"],
    )
  })

  test("OR returns the union", () => {
    assert.deepEqual(
      filterByTags(pages, ["dwarves", "fey"], "or").map((e) => e.slug),
      ["a", "b", "c"],
    )
  })

  test("AND with an impossible combination returns nothing", () => {
    assert.deepEqual(filterByTags(pages, ["dwarves", "fey"], "and"), [])
  })

  test("a single tag behaves the same in both modes", () => {
    assert.deepEqual(
      filterByTags(pages, ["fey"], "and").map((e) => e.slug),
      filterByTags(pages, ["fey"], "or").map((e) => e.slug),
    )
  })
})

describe("resolvesToPage", () => {
  const slugs = new Set([
    "five-banners-burning-campaign/deyonahua/deyotlan",
    "five-banners-burning-campaign/deyonahua/index",
    "top",
  ])

  test("exact slug", () => assert.ok(resolvesToPage("top", slugs)))
  test("shortest-form match on the last segment", () =>
    assert.ok(resolvesToPage("deyotlan", slugs)))
  test("folder reached via its index page", () => assert.ok(resolvesToPage("deyonahua", slugs)))
  test("a genuinely missing target does not resolve", () =>
    assert.ok(!resolvesToPage("yollotlan", slugs)))
  test("a partial word is not a match", () => assert.ok(!resolvesToPage("deyot", slugs)))

  test("an alias redirect stub counts as a real destination", () => {
    // Alias stubs are emitted as HTML but never enter contentIndex.json, so without
    // the alias set a perfectly good link would be reported as broken.
    const aliases = new Set(["realm-of-the-sun"])
    assert.ok(!resolvesToPage("realm-of-the-sun", slugs))
    assert.ok(resolvesToPage("realm-of-the-sun", slugs, aliases))
  })
})

describe("unresolvedLinks", () => {
  test("finds targets that do not exist and groups them by source", () => {
    const pages = [
      entry("a", [], ["missing", "b"]),
      entry("b", [], ["missing"]),
      entry("c", [], []),
    ]
    const out = unresolvedLinks(pages)
    assert.equal(out.length, 1)
    assert.equal(out[0].target, "missing")
    assert.deepEqual(out[0].sources, ["a", "b"])
  })

  test("ignores external links", () => {
    assert.deepEqual(unresolvedLinks([entry("a", [], ["https://example.com"])]), [])
  })

  test("strips heading and block anchors before resolving", () => {
    assert.deepEqual(unresolvedLinks([entry("a", [], ["a#section"])]), [])
  })

  test("links through an alias are not reported as broken", () => {
    const pages = [entry("a", [], ["realm-of-the-sun"])]
    assert.equal(unresolvedLinks(pages).length, 1, "expected a false positive without aliases")
    assert.deepEqual(unresolvedLinks(pages, new Set(["realm-of-the-sun"])), [])
  })

  test("orders by how many pages are waiting on the target", () => {
    const pages = [
      entry("a", [], ["popular", "rare"]),
      entry("b", [], ["popular"]),
      entry("c", [], ["popular"]),
    ]
    assert.deepEqual(
      unresolvedLinks(pages).map((o) => o.target),
      ["popular", "rare"],
    )
  })
})

describe("humanise", () => {
  test("turns a slug into a title", () => {
    assert.equal(humanise("the-celestial-twins"), "The Celestial Twins")
    assert.equal(humanise("a/b/quil_na_sko"), "Quil Na Sko")
  })
})

/**
 * Against the project's real index: the broken-link panel should surface the backlog
 * of wikilinks written before their target pages existed.
 */
describe("against the real site data", () => {
  const indexPath = path.resolve(import.meta.dirname, "../../../public/static/contentIndex.json")
  const available = fs.existsSync(indexPath)

  test("finds the known backlog of unwritten pages", { skip: !available }, () => {
    const raw = JSON.parse(fs.readFileSync(indexPath, "utf8"))
    const entries = contentEntries(raw.content ?? raw)
    const orphans = unresolvedLinks(entries)

    assert.ok(orphans.length > 10, `expected a real backlog, found ${orphans.length}`)
    const targets = orphans.map((o) => o.target)
    // Sampled from the actual campaign content.
    for (const known of ["yollotlan", "tecpan-olin", "the-succession"]) {
      assert.ok(targets.includes(known), `expected "${known}" among the unresolved links`)
    }
    // Pages that do exist must never appear.
    assert.ok(!targets.includes("deyotlan"), "a page that exists was reported as missing")
  })

  test("every tag in the index is countable", { skip: !available }, () => {
    const raw = JSON.parse(fs.readFileSync(indexPath, "utf8"))
    const entries = contentEntries(raw.content ?? raw)
    const counts = tagCounts(entries)
    assert.ok(counts.length > 0)
    for (const { tag, count } of counts) {
      assert.equal(count, filterByTags(entries, [tag], "and").length, `count wrong for ${tag}`)
    }
  })
})
