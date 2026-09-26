import test, { describe } from "node:test"
import assert from "node:assert"
import { moveItem } from "./dnd"
import type { RenderedGroup } from "./reconcile"

const group = (id: string, slugs: string[]): RenderedGroup => ({
  id,
  label: id,
  collapsed: false,
  items: slugs.map((s) => ({ slug: s, label: s, url: `/${s}` })),
})

const shape = (m: RenderedGroup[]) => m.map((g) => [g.id, g.items.map((i) => i.slug)])

describe("moveItem", () => {
  test("reorders within a group, moving down", () => {
    const model = [group("a", ["one", "two", "three"])]
    // Move "one" to the slot after "two".
    assert.deepEqual(
      shape(moveItem(model, { groupIndex: 0, itemIndex: 0 }, { groupIndex: 0, itemIndex: 2 })),
      [["a", ["two", "one", "three"]]],
    )
  })

  test("reorders within a group, moving up", () => {
    const model = [group("a", ["one", "two", "three"])]
    assert.deepEqual(
      shape(moveItem(model, { groupIndex: 0, itemIndex: 2 }, { groupIndex: 0, itemIndex: 0 })),
      [["a", ["three", "one", "two"]]],
    )
  })

  test("moves across groups", () => {
    const model = [group("a", ["one", "two"]), group("b", ["three"])]
    assert.deepEqual(
      shape(moveItem(model, { groupIndex: 0, itemIndex: 0 }, { groupIndex: 1, itemIndex: 0 })),
      [
        ["a", ["two"]],
        ["b", ["one", "three"]],
      ],
    )
  })

  test("appends to the end of a target group", () => {
    const model = [group("a", ["one"]), group("b", ["two", "three"])]
    assert.deepEqual(
      shape(moveItem(model, { groupIndex: 0, itemIndex: 0 }, { groupIndex: 1, itemIndex: 2 })),
      [
        ["a", []],
        ["b", ["two", "three", "one"]],
      ],
    )
  })

  test("a no-op move leaves the order unchanged", () => {
    const model = [group("a", ["one", "two"])]
    assert.deepEqual(
      shape(moveItem(model, { groupIndex: 0, itemIndex: 0 }, { groupIndex: 0, itemIndex: 0 })),
      [["a", ["one", "two"]]],
    )
  })

  test("does not mutate the input model", () => {
    const model = [group("a", ["one", "two"]), group("b", [])]
    const before = JSON.stringify(model)
    moveItem(model, { groupIndex: 0, itemIndex: 0 }, { groupIndex: 1, itemIndex: 0 })
    assert.equal(JSON.stringify(model), before, "input model was mutated")
  })

  test("never loses or duplicates an item", () => {
    let model = [group("a", ["one", "two", "three"]), group("b", ["four"])]
    const all = () => model.flatMap((g) => g.items.map((i) => i.slug)).sort()
    const expected = all()

    // A deliberately awkward sequence of moves.
    const moves: [number, number, number, number][] = [
      [0, 2, 1, 0],
      [1, 1, 0, 0],
      [0, 0, 1, 1],
      [1, 0, 0, 3],
    ]
    for (const [fg, fi, tg, ti] of moves) {
      if (!model[fg]?.items[fi]) continue
      model = moveItem(model, { groupIndex: fg, itemIndex: fi }, { groupIndex: tg, itemIndex: ti })
      assert.deepEqual(all(), expected, "an item was lost or duplicated")
    }
  })

  test("clamps an out-of-range target rather than corrupting the model", () => {
    const model = [group("a", ["one"]), group("b", ["two"])]
    const out = moveItem(model, { groupIndex: 0, itemIndex: 0 }, { groupIndex: 1, itemIndex: 99 })
    assert.deepEqual(shape(out), [
      ["a", []],
      ["b", ["two", "one"]],
    ])
  })
})
