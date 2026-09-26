/**
 * Tag browsing for /browse.
 *
 * Runs entirely against the content index the build already emits, so filtering is
 * instant and costs nothing at build time.
 *
 * State lives in the URL (`/browse?tags=fey,lore&mode=and`) so a filtered view is
 * shareable and the back button behaves.
 *
 * The loader in quartz/cli/handlers.js rewrites this file with two naive string
 * replacements, so the keyword it looks for must appear exactly once, on the last line.
 */
import {
  contentEntries,
  tagCounts,
  filterByTags,
  unresolvedLinks,
  humanise,
  type IndexEntry,
  type CombineMode,
} from "../wiki/tags"

let entries: IndexEntry[] = []
let selected = new Set<string>()
let mode: CombineMode = "and"
let isAdmin = false
let aliasSlugs = new Set<string>()

// --- url state ---------------------------------------------------------------

function readUrl() {
  const params = new URLSearchParams(location.search)
  const tags = (params.get("tags") ?? "")
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean)
  selected = new Set(tags)
  mode = params.get("mode") === "or" ? "or" : "and"
}

function writeUrl() {
  const params = new URLSearchParams()
  if (selected.size > 0) params.set("tags", [...selected].join(","))
  if (mode !== "and") params.set("mode", mode)
  const qs = params.toString()
  history.replaceState(null, "", qs ? `${location.pathname}?${qs}` : location.pathname)
}

// --- rendering ---------------------------------------------------------------

function slugUrl(slug: string): string {
  return "/" + slug.split("/").map(encodeURIComponent).join("/")
}

function renderTags(filterText: string) {
  const host = document.getElementById("browse-tags")
  if (!host) return
  const needle = filterText.trim().toLowerCase()
  const counts = tagCounts(entries).filter((t) => !needle || t.tag.toLowerCase().includes(needle))

  host.textContent = ""
  if (counts.length === 0) {
    const p = document.createElement("p")
    p.className = "admin-empty"
    p.textContent = "No tags match."
    host.appendChild(p)
    return
  }

  for (const { tag, count } of counts) {
    const chip = document.createElement("button")
    chip.type = "button"
    chip.className = "browse-chip"
    chip.setAttribute("aria-pressed", selected.has(tag) ? "true" : "false")
    if (selected.has(tag)) chip.classList.add("is-selected")
    chip.innerHTML = `<span class="browse-chip-name"></span><span class="browse-chip-count"></span>`
    chip.querySelector(".browse-chip-name")!.textContent = tag
    chip.querySelector(".browse-chip-count")!.textContent = String(count)
    chip.addEventListener("click", () => {
      if (selected.has(tag)) selected.delete(tag)
      else selected.add(tag)
      writeUrl()
      renderAll(filterText)
    })
    host.appendChild(chip)
  }
}

function renderResults() {
  const list = document.getElementById("browse-results")
  const count = document.getElementById("browse-count")
  const status = document.getElementById("browse-status")
  if (!list) return

  const matches = filterByTags(entries, [...selected], mode).sort((a, b) =>
    (a.title ?? a.slug).localeCompare(b.title ?? b.slug),
  )

  if (count) {
    count.textContent =
      selected.size > 0 ? `${matches.length} of ${entries.length}` : String(entries.length)
  }
  if (status) {
    status.textContent =
      selected.size === 0
        ? "Select tags above to narrow this list."
        : `${mode === "and" ? "All of" : "Any of"}: ${[...selected].join(", ")}`
  }

  list.textContent = ""
  if (matches.length === 0) {
    const li = document.createElement("li")
    li.className = "admin-empty"
    li.textContent = "No page carries that combination of tags."
    list.appendChild(li)
    return
  }

  const frag = document.createDocumentFragment()
  for (const entry of matches) {
    const li = document.createElement("li")
    const a = document.createElement("a")
    a.href = slugUrl(entry.slug.replace(/\/index$/, ""))

    const title = document.createElement("span")
    title.className = "admin-item-title"
    title.textContent = entry.title || entry.slug

    const crumb = document.createElement("span")
    crumb.className = "admin-item-path"
    crumb.textContent = entry.slug.split("/").slice(0, -1).join(" / ") || "root"

    a.append(title, crumb)

    if (entry.tags && entry.tags.length > 0) {
      const tags = document.createElement("span")
      tags.className = "admin-tags"
      for (const tag of entry.tags) {
        const chip = document.createElement("span")
        chip.className = "admin-tag"
        if (selected.has(tag)) chip.classList.add("is-matched")
        chip.textContent = tag
        tags.appendChild(chip)
      }
      a.appendChild(tags)
    }

    li.appendChild(a)
    frag.appendChild(li)
  }
  list.appendChild(frag)
}

function renderOrphans() {
  const list = document.getElementById("browse-orphans")
  const count = document.getElementById("browse-orphan-count")
  if (!list) return

  const orphans = unresolvedLinks(entries, aliasSlugs)
  if (count) count.textContent = String(orphans.length)

  list.textContent = ""
  if (orphans.length === 0) {
    const li = document.createElement("li")
    li.className = "admin-empty"
    li.textContent = "Every wikilink resolves."
    list.appendChild(li)
    return
  }

  const frag = document.createDocumentFragment()
  for (const orphan of orphans) {
    const li = document.createElement("li")
    li.className = "browse-orphan"

    const main = document.createElement("div")
    main.className = "browse-orphan-main"

    const name = document.createElement("span")
    name.className = "admin-item-title"
    name.textContent = humanise(orphan.target)

    const from = document.createElement("span")
    from.className = "admin-item-path"
    from.textContent = `linked from ${orphan.sources.length} page${orphan.sources.length === 1 ? "" : "s"}: ${orphan.sources.join(", ")}`

    main.append(name, from)
    li.appendChild(main)

    if (isAdmin) {
      const create = document.createElement("a")
      create.className = "browse-create"
      // Suggest the folder of the first page that links here, so a new note lands
      // beside the material that refers to it.
      const suggestedFolder = orphan.sources[0]?.split("/").slice(0, -1).join("/") ?? ""
      const params = new URLSearchParams({
        title: humanise(orphan.target),
        from: orphan.sources[0] ?? "",
      })
      if (suggestedFolder) params.set("folder", `content/${suggestedFolder}`)
      create.href = `/admin/new?${params.toString()}`
      create.textContent = "Create"
      li.appendChild(create)
    }

    frag.appendChild(li)
  }
  list.appendChild(frag)
}

function renderAll(filterText: string) {
  renderTags(filterText)
  renderResults()
  const clear = document.getElementById("browse-clear")
  if (clear) clear.hidden = selected.size === 0
}

// --- boot --------------------------------------------------------------------

function initTheme() {
  document.getElementById("admin-theme-toggle")?.addEventListener("click", () => {
    const root = document.documentElement
    const next = root.getAttribute("data-theme") === "dark" ? "light" : "dark"
    root.setAttribute("data-theme", next)
    try {
      localStorage.setItem("theme", next)
    } catch {
      /* private browsing */
    }
  })
}

function initModeButtons() {
  const andBtn = document.getElementById("browse-mode-and")
  const orBtn = document.getElementById("browse-mode-or")
  const apply = () => {
    andBtn?.classList.toggle("is-active", mode === "and")
    orBtn?.classList.toggle("is-active", mode === "or")
    andBtn?.setAttribute("aria-checked", mode === "and" ? "true" : "false")
    orBtn?.setAttribute("aria-checked", mode === "or" ? "true" : "false")
  }
  andBtn?.addEventListener("click", () => {
    mode = "and"
    apply()
    writeUrl()
    renderResults()
  })
  orBtn?.addEventListener("click", () => {
    mode = "or"
    apply()
    writeUrl()
    renderResults()
  })
  apply()
}

async function boot() {
  initTheme()
  readUrl()
  initModeButtons()

  const filterInput = document.getElementById("browse-tag-filter") as HTMLInputElement | null
  filterInput?.addEventListener("input", () => renderAll(filterInput.value))

  document.getElementById("browse-clear")?.addEventListener("click", () => {
    selected.clear()
    writeUrl()
    renderAll(filterInput?.value ?? "")
  })

  // The back button should restore a shared filter state.
  window.addEventListener("popstate", () => {
    readUrl()
    initModeButtons()
    renderAll(filterInput?.value ?? "")
  })

  const status = document.getElementById("browse-status")
  try {
    const res = await fetch("/static/contentIndex.json", { cache: "no-cache" })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const raw = await res.json()
    entries = contentEntries(raw?.content ?? raw)
  } catch (err) {
    if (status) status.textContent = `Could not load the page index: ${err}`
    return
  }

  // Alias redirect stubs are valid link destinations but never appear in the content
  // index, so without this the orphan panel would report working links as broken.
  try {
    const res = await fetch("/static/wiki-meta.json", { cache: "no-cache" })
    if (res.ok) aliasSlugs = new Set(Object.keys((await res.json())?.aliases ?? {}))
  } catch {
    // The panel still works; it may just be slightly pessimistic.
  }

  // Admins get a "Create" action on each unresolved link. Failure just means no
  // button, so this never blocks rendering.
  try {
    const res = await fetch("/api/session", { headers: { "X-Deyotlan-Admin": "1" } })
    isAdmin = res.ok && (await res.json())?.admin === true
  } catch {
    isAdmin = false
  }

  renderAll("")
  renderOrphans()
}

void boot()

// The loader strips the two leading keywords below, leaving an inert string literal.
export default ""
