/**
 * Curated wiki navigation, built client-side.
 *
 * Reads the generated content index (via the global `fetchData` promise that every
 * page already carries) and a curated manifest at /static/nav.json, reconciles them,
 * and paints the result into the explorer DOM.
 *
 * Two properties matter more than anything else here:
 *
 *  1. **The nav can never break the site.** Any failure to load or parse the manifest
 *     falls back to rendering the plain folder tree.
 *  2. **No page can become invisible.** Reconciliation places anything the manifest
 *     does not mention, so a newly created page always appears somewhere sensible
 *     without the manifest being touched.
 *
 * The loader in quartz/cli/handlers.js rewrites this file with two naive string
 * replacements before bundling, so the keyword it looks for must appear exactly once,
 * on the final line.
 */

import {
  reconcile,
  displaySlug,
  UNFILED_GROUP_ID,
  type ContentDetails,
  type NavManifest,
  type RenderedGroup,
} from "../wiki/reconcile"
import { attachDnd } from "../wiki/dnd"

const COLLAPSE_KEY = "deyotlan-nav"
const SCROLL_KEY = "deyotlan-nav-scroll"

function basePath(): string {
  return document.body?.dataset?.basepath ?? ""
}

function readCollapseState(): Record<string, boolean> {
  try {
    const raw = localStorage.getItem(COLLAPSE_KEY)
    return raw ? (JSON.parse(raw) ?? {}) : {}
  } catch {
    return {}
  }
}

function writeCollapseState(state: Record<string, boolean>) {
  try {
    localStorage.setItem(COLLAPSE_KEY, JSON.stringify(state))
  } catch {
    /* private browsing; collapse state is per-view only */
  }
}

// --- manifest and supplementary metadata -------------------------------------

let manifestCache: NavManifest | null | undefined
let datesCache: Record<string, string> | undefined

/**
 * Dates come from /static/wiki-meta.json because the generated content index carries
 * none. Without them a group set to sort newest-first would silently fall back to
 * sorting by title.
 */
async function loadDates(): Promise<Record<string, string>> {
  if (datesCache !== undefined) return datesCache
  try {
    const res = await fetch(`${basePath()}/static/wiki-meta.json`, { cache: "no-cache" })
    datesCache = res.ok ? ((await res.json())?.dates ?? {}) : {}
  } catch {
    datesCache = {}
  }
  return datesCache ?? {}
}

async function loadManifest(): Promise<NavManifest | null> {
  if (manifestCache !== undefined) return manifestCache
  try {
    const res = await fetch(`${basePath()}/static/nav.json`, { cache: "no-cache" })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const data = (await res.json()) as NavManifest
    if (data?.version !== 1 || !Array.isArray(data.groups)) {
      console.warn("[wiki-nav] Unsupported nav.json; falling back to the folder tree.")
      manifestCache = null
    } else {
      manifestCache = data
    }
  } catch (err) {
    console.warn("[wiki-nav] Could not load nav.json; falling back to the folder tree.", err)
    manifestCache = null
  }
  return manifestCache
}

// --- painting ----------------------------------------------------------------

function paint(root: HTMLElement, groups: RenderedGroup[], currentSlug: string) {
  const list = root.querySelector<HTMLUListElement>(".explorer-ul")
  const fileTpl = document.getElementById("template-file") as HTMLTemplateElement | null
  const folderTpl = document.getElementById("template-folder") as HTMLTemplateElement | null
  if (!list || !fileTpl || !folderTpl) return

  const collapseState = readCollapseState()
  const current = displaySlug(currentSlug)

  list.innerHTML = '<li class="overflow-end"></li>'
  const frag = document.createDocumentFragment()

  for (const group of groups) {
    const node = folderTpl.content.cloneNode(true) as DocumentFragment
    const container = node.querySelector<HTMLElement>(".folder-container")
    const titleEl = node.querySelector<HTMLElement>(".folder-title")
    const outer = node.querySelector<HTMLElement>(".folder-outer")
    const inner = node.querySelector<HTMLElement>("ul.content")

    if (titleEl) titleEl.textContent = group.label
    // Groups are not folders, so the identifier is a group id rather than a path.
    if (container) container.dataset.groupid = group.id

    const holdsCurrent = group.items.some((i) => displaySlug(i.slug) === current)
    const saved = collapseState[group.id]
    const collapsed = holdsCurrent ? false : (saved ?? group.collapsed)
    if (!collapsed) outer?.classList.add("open")

    for (const item of group.items) {
      const fileNode = fileTpl.content.cloneNode(true) as DocumentFragment
      const a = fileNode.querySelector("a")
      if (a) {
        a.href = item.url
        a.textContent = item.label
        a.dataset.slug = item.slug
        if (displaySlug(item.slug) === current) a.classList.add("active", "is-active")
      }
      inner?.appendChild(fileNode)
    }

    frag.appendChild(node)
  }

  list.appendChild(frag)
}

// --- interaction -------------------------------------------------------------

function wire(root: HTMLElement) {
  const cleanups: Array<() => void> = []
  const on = (el: Element, ev: string, fn: EventListener) => {
    el.addEventListener(ev, fn)
    cleanups.push(() => el.removeEventListener(ev, fn))
  }

  // The drawer toggle. `.collapsed` on `.explorer` is the contract the mobile
  // stylesheet keys on; mobile-navigation.scss warns against replacing it.
  for (const toggle of root.getElementsByClassName("explorer-toggle")) {
    on(toggle, "click", () => {
      const collapsed = root.classList.toggle("collapsed")
      root.setAttribute("aria-expanded", collapsed ? "false" : "true")
      document.documentElement.classList.toggle("mobile-no-scroll", !collapsed)
    })
  }

  const toggleGroup = (container: HTMLElement) => {
    const outer = container.nextElementSibling
    if (!(outer instanceof HTMLElement)) return
    outer.classList.toggle("open")
    const state = readCollapseState()
    state[container.dataset.groupid ?? ""] = !outer.classList.contains("open")
    writeCollapseState(state)
  }

  for (const icon of root.getElementsByClassName("folder-icon")) {
    on(icon, "click", (e) => {
      e.stopPropagation()
      const container = (e.currentTarget as HTMLElement).closest<HTMLElement>(".folder-container")
      if (container) toggleGroup(container)
    })
  }

  for (const button of root.getElementsByClassName("folder-button")) {
    on(button, "click", (e) => {
      e.preventDefault()
      e.stopPropagation()
      const container = (e.currentTarget as HTMLElement).closest<HTMLElement>(".folder-container")
      if (container) toggleGroup(container)
    })
  }

  if (typeof window !== "undefined" && window.addCleanup) {
    window.addCleanup(() => cleanups.forEach((fn) => fn()))
  }
}

// --- admin: reordering and persistence ---------------------------------------

const PENDING_KEY = "deyotlan-nav-pending"
const ADMIN_CACHE_KEY = "deyotlan-nav-admin"
const PUBLISH_DEBOUNCE_MS = 30000

let adminChecked = false
let isAdmin = false
let currentModel: RenderedGroup[] = []
let publishTimer: number | undefined
let detachDnd: (() => void) | null = null

/**
 * Whether the viewer can edit. Memoised in sessionStorage for a minute so the public
 * site does not issue a request per navigation. The response carries nothing but the
 * boolean.
 */
async function checkAdmin(): Promise<boolean> {
  if (adminChecked) return isAdmin
  adminChecked = true
  try {
    const cached = sessionStorage.getItem(ADMIN_CACHE_KEY)
    if (cached) {
      const { admin, at } = JSON.parse(cached)
      if (Date.now() - at < 60000) {
        isAdmin = admin === true
        return isAdmin
      }
    }
  } catch {
    /* fall through to the network check */
  }
  try {
    const res = await fetch(`${basePath()}/api/session`, {
      headers: { "X-Deyotlan-Admin": "1" },
      credentials: "same-origin",
    })
    isAdmin = res.ok && (await res.json())?.admin === true
    try {
      sessionStorage.setItem(ADMIN_CACHE_KEY, JSON.stringify({ admin: isAdmin, at: Date.now() }))
    } catch {
      /* private browsing */
    }
  } catch {
    isAdmin = false
  }
  return isAdmin
}

function announce(message: string) {
  let live = document.getElementById("wiki-nav-live")
  if (!live) {
    live = document.createElement("div")
    live.id = "wiki-nav-live"
    live.className = "visually-hidden"
    live.setAttribute("aria-live", "polite")
    document.body.appendChild(live)
  }
  live.textContent = message
}

function setStatus(text: string, kind: "idle" | "pending" | "busy" | "ok" | "error") {
  const bar = document.querySelector<HTMLElement>(".wiki-nav-status")
  if (!bar) return
  bar.dataset.kind = kind
  bar.hidden = kind === "idle"
  const label = bar.querySelector(".wiki-nav-status-text")
  if (label) label.textContent = text
}

/**
 * Fold the rendered model back into a manifest.
 *
 * Every rendered item is written as an explicit entry, so what you see is exactly
 * what is stored. Folder hints are preserved, so pages created later still get
 * placed automatically without the manifest being edited.
 */
function modelToManifest(model: RenderedGroup[], base: NavManifest | null): NavManifest {
  const byId = new Map((base?.groups ?? []).map((g) => [g.id, g]))
  const groups = model
    .filter((g) => g.id !== UNFILED_GROUP_ID)
    .map((g) => {
      const original = byId.get(g.id)
      return {
        id: g.id,
        label: g.label,
        collapsed: g.collapsed || undefined,
        folderHints: original?.folderHints,
        autoSort: original?.autoSort,
        items: g.items.map((i) => ({ slug: i.slug })),
      }
    })

  // Anything dragged into the synthetic "Unfiled" group is kept, under its own real
  // group, so the ordering is not silently lost on the next load.
  const unfiled = model.find((g) => g.id === UNFILED_GROUP_ID)
  if (unfiled && unfiled.items.length > 0) {
    groups.push({
      id: "g-unfiled",
      label: base?.fallbackGroupLabel ?? "Unfiled",
      collapsed: undefined,
      folderHints: undefined,
      autoSort: undefined,
      items: unfiled.items.map((i) => ({ slug: i.slug })),
    })
  }

  return {
    version: 1,
    groups: groups as NavManifest["groups"],
    hidden: base?.hidden ?? [],
    fallbackGroupLabel: base?.fallbackGroupLabel ?? "Unfiled",
  }
}

function savePending(model: RenderedGroup[]) {
  try {
    localStorage.setItem(PENDING_KEY, JSON.stringify(model))
  } catch {
    /* private browsing; the in-memory model still applies for this view */
  }
}

function clearPending() {
  try {
    localStorage.removeItem(PENDING_KEY)
  } catch {
    /* nothing to do */
  }
}

function readPending(): RenderedGroup[] | null {
  try {
    const raw = localStorage.getItem(PENDING_KEY)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

async function publish() {
  if (publishTimer !== undefined) {
    clearTimeout(publishTimer)
    publishTimer = undefined
  }
  const model = readPending()
  if (!model) return

  setStatus("Publishing…", "busy")
  const manifest = modelToManifest(model, manifestCache ?? null)

  try {
    const res = await fetch(`${basePath()}/api/nav`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Deyotlan-Admin": "1" },
      credentials: "same-origin",
      body: JSON.stringify({ manifest }),
      // keepalive rather than sendBeacon: a beacon cannot carry the CSRF header.
      keepalive: true,
    })
    const data = await res.json().catch(() => null)

    if (!res.ok) {
      setStatus(
        res.status === 409
          ? "The nav changed elsewhere. Reload before saving."
          : (data?.message ?? "Could not save the order."),
        "error",
      )
      return
    }

    clearPending()
    manifestCache = manifest
    setStatus(data?.local ? "Saved." : "Published. Live in about a minute.", "ok")
    window.setTimeout(() => setStatus("", "idle"), 6000)
  } catch {
    setStatus("Not saved — still offline. It will retry.", "error")
  }
}

function schedulePublish() {
  if (publishTimer !== undefined) clearTimeout(publishTimer)
  // Long on purpose: every save is a commit and a full site rebuild, and a curation
  // session is twenty drags. The person doing the dragging already sees the new order
  // from the optimistic local copy, so only other visitors wait.
  publishTimer = window.setTimeout(() => void publish(), PUBLISH_DEBOUNCE_MS)
}

function ensureStatusBar(root: HTMLElement) {
  if (root.querySelector(".wiki-nav-status")) return
  const bar = document.createElement("div")
  bar.className = "wiki-nav-status"
  bar.hidden = true
  bar.innerHTML =
    '<span class="wiki-nav-status-text"></span>' +
    '<button type="button" class="wiki-nav-publish">Publish now</button>'
  root.querySelector(".explorer-content")?.appendChild(bar)
  bar.querySelector(".wiki-nav-publish")?.addEventListener("click", () => void publish())
}

// --- render loop -------------------------------------------------------------

// Guards against the SPA firing `nav` and `render` in quick succession: a slow
// fetchData from an earlier render must never paint over a newer one.
let generation = 0

async function render(currentSlug: string) {
  const mine = ++generation

  const roots = document.querySelectorAll<HTMLElement>("div.wiki-nav")
  if (roots.length === 0) return

  let index: Record<string, ContentDetails> = {}
  try {
    const raw = (await fetchData) as any
    index = raw?.content ?? raw ?? {}
  } catch (err) {
    console.error("[wiki-nav] Could not load the content index.", err)
    return
  }

  const [manifest, dates] = await Promise.all([loadManifest(), loadDates()])
  if (mine !== generation) return

  // An unpublished reorder survives a reload, so the curator never loses work to a
  // dropped connection mid-session.
  const pending = readPending()
  const groups = pending ?? reconcile(index, manifest, basePath(), dates)
  currentModel = groups

  const admin = await checkAdmin()
  if (mine !== generation) return

  for (const root of roots) {
    paint(root, groups, currentSlug)
    wire(root)

    detachDnd?.()
    detachDnd = null

    if (admin) {
      ensureStatusBar(root)

      // Repainting replaces the rows the grips were attached to, so the drag
      // handlers are torn down and rebuilt around the new DOM after every move.
      const attach = () => {
        detachDnd?.()
        detachDnd = attachDnd({
          root,
          getModel: () => currentModel,
          onReorder: (next) => {
            // Optimistic: paint immediately, persist later. The curator sees the new
            // order at once; only other visitors wait for the deploy.
            currentModel = next
            savePending(next)
            paint(root, next, currentSlug)
            attach()
            setStatus("Unsaved changes", "pending")
            schedulePublish()
          },
          announce,
        })
      }
      attach()

      if (pending) setStatus("Unsaved changes", "pending")
    }

    const mobileToggle = root.querySelector(".mobile-explorer")
    if (mobileToggle) {
      mobileToggle.classList.remove("hide-until-loaded")
      if ((mobileToggle as any).checkVisibility?.()) {
        root.classList.add("collapsed")
        root.setAttribute("aria-expanded", "false")
        document.documentElement.classList.remove("mobile-no-scroll")
      }
    }

    const list = root.querySelector<HTMLElement>(".explorer-ul")
    const saved = sessionStorage.getItem(SCROLL_KEY)
    if (list && saved) {
      list.scrollTop = parseInt(saved, 10)
    } else {
      list?.querySelector(".active")?.scrollIntoView({ block: "nearest" })
    }
  }

  document.dispatchEvent(new CustomEvent("wikinavrendered", { detail: { groups } }))
}

function currentSlugFromBody(): string {
  return document.body?.dataset?.slug ?? ""
}

document.addEventListener("nav", (e: CustomEvent<{ url: string }>) => {
  void render(e.detail?.url ?? currentSlugFromBody())
})
document.addEventListener("render", () => {
  void render(currentSlugFromBody())
})
// Flush before the tab goes away, so a reorder is not stranded in localStorage.
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden" && readPending()) void publish()
})
window.addEventListener("pagehide", () => {
  if (readPending()) void publish()
})

document.addEventListener("prenav", () => {
  const list = document.querySelector<HTMLElement>(".wiki-nav .explorer-ul")
  if (list) sessionStorage.setItem(SCROLL_KEY, String(list.scrollTop))
})

// The loader strips the two leading keywords below, leaving an inert string literal.
// TypeScript still needs the declaration so the component can import this as text.
export default ""
