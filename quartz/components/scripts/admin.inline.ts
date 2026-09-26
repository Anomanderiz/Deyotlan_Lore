/**
 * Deyotlan admin client.
 *
 * Bundled by the inline-script-loader in quartz/cli/handlers.js and inlined into the
 * emitted /admin document.
 *
 * That loader rewrites the source with two naive string replacements before handing
 * it to esbuild. Consequently the literal word below must not appear anywhere in this
 * file except on the final line -- writing it in a comment would consume the
 * replacement and silently change what gets generated.
 */

interface ContentDetails {
  slug: string
  filePath: string
  title: string
  links?: string[]
  tags?: string[]
  content?: string
}

const CSRF_HEADER = "X-Deyotlan-Admin"

// --- api client --------------------------------------------------------------

interface ApiResult<T> {
  ok: boolean
  status: number
  data: T
}

async function api<T = any>(
  path: string,
  init: { method?: string; body?: unknown } = {},
): Promise<ApiResult<T>> {
  const method = init.method ?? "GET"
  const headers: Record<string, string> = { [CSRF_HEADER]: "1" }
  let body: string | undefined
  if (init.body !== undefined) {
    headers["Content-Type"] = "application/json"
    body = JSON.stringify(init.body)
  }
  try {
    const res = await fetch(path, { method, headers, body, credentials: "same-origin" })
    let data: any = null
    try {
      data = await res.json()
    } catch {
      data = null
    }
    return { ok: res.ok, status: res.status, data }
  } catch (err) {
    // Network failure, not an HTTP error. Distinguish it, because "you are offline"
    // and "the server said no" need different responses from the user.
    return { ok: false, status: 0, data: { error: "network", message: String(err) } as any }
  }
}

function errorMessage(result: ApiResult<any>, fallback: string): string {
  if (result.status === 0) return "No connection. Check your signal and try again."
  const msg = result.data?.message
  return typeof msg === "string" && msg.length > 0 ? msg : fallback
}

// --- status helpers ----------------------------------------------------------

type StatusKind = "idle" | "busy" | "ok" | "error"

function setStatus(el: HTMLElement | null, kind: StatusKind, text: string) {
  if (!el) return
  el.dataset.kind = kind
  el.textContent = ""
  if (kind === "busy") {
    const spinner = document.createElement("span")
    spinner.className = "admin-spinner"
    el.appendChild(spinner)
  }
  if (text) el.appendChild(document.createTextNode(text))
}

// --- theme -------------------------------------------------------------------

function initTheme() {
  const toggle = document.getElementById("admin-theme-toggle")
  toggle?.addEventListener("click", () => {
    const root = document.documentElement
    const next = root.getAttribute("data-theme") === "dark" ? "light" : "dark"
    root.setAttribute("data-theme", next)
    try {
      localStorage.setItem("theme", next)
    } catch {
      /* private browsing; the toggle still works for this page view */
    }
  })
}

// --- auth --------------------------------------------------------------------

function showLogin(message?: string) {
  const login = document.getElementById("admin-login")
  const app = document.getElementById("admin-app")
  if (login) login.hidden = false
  if (app) app.hidden = true
  if (message) {
    setStatus(document.getElementById("admin-login-status"), "error", message)
  }
  document.getElementById("admin-password")?.focus()
}

function showApp() {
  const login = document.getElementById("admin-login")
  const app = document.getElementById("admin-app")
  if (login) login.hidden = true
  if (app) app.hidden = false
}

function initLoginForm() {
  const form = document.getElementById("admin-login-form") as HTMLFormElement | null
  const input = document.getElementById("admin-password") as HTMLInputElement | null
  const submit = document.getElementById("admin-login-submit") as HTMLButtonElement | null
  const status = document.getElementById("admin-login-status")
  if (!form || !input) return

  form.addEventListener("submit", async (e) => {
    e.preventDefault()
    if (submit) submit.disabled = true
    setStatus(status, "busy", "Checking…")

    const result = await api("/api/login", { method: "POST", body: { password: input.value } })

    if (submit) submit.disabled = false
    if (result.ok) {
      input.value = ""
      setStatus(status, "idle", "")
      showApp()
      void startPage()
      return
    }
    if (result.status === 429) {
      const retry = result.data?.retryAfter
      setStatus(
        status,
        "error",
        typeof retry === "number"
          ? `Too many attempts. Try again in ${Math.ceil(retry / 60)} min.`
          : "Too many attempts. Try again later.",
      )
      return
    }
    setStatus(status, "error", errorMessage(result, "Incorrect password."))
    input.select()
  })
}

function initLogout() {
  document.getElementById("admin-logout")?.addEventListener("click", async () => {
    await api("/api/logout", { method: "POST", body: {} })
    location.reload()
  })
}

// --- dashboard ---------------------------------------------------------------

let allPages: ContentDetails[] = []

function isContentPage(slug: string): boolean {
  // Tag pages are generated, not authored, so they are not editable content.
  return !slug.startsWith("tags/")
}

function renderList(filter: string) {
  const list = document.getElementById("admin-list")
  const count = document.getElementById("admin-page-count")
  if (!list) return

  const needle = filter.trim().toLowerCase()
  const matches = needle
    ? allPages.filter((p) => {
        const haystack = [p.title, p.filePath, p.slug, ...(p.tags ?? [])].join(" ").toLowerCase()
        return haystack.includes(needle)
      })
    : allPages

  if (count) {
    count.textContent = needle ? `${matches.length} of ${allPages.length}` : `${allPages.length}`
  }

  list.textContent = ""
  if (matches.length === 0) {
    const li = document.createElement("li")
    li.className = "admin-empty"
    li.textContent = needle ? "Nothing matches that filter." : "No pages yet."
    list.appendChild(li)
    return
  }

  const frag = document.createDocumentFragment()
  for (const page of matches) {
    const li = document.createElement("li")
    const a = document.createElement("a")
    // Slugs can contain characters like ";" that must survive URL construction.
    a.href = "/" + page.slug.split("/").map(encodeURIComponent).join("/")

    const title = document.createElement("span")
    title.className = "admin-item-title"
    title.textContent = page.title || page.slug

    const path = document.createElement("span")
    path.className = "admin-item-path"
    path.textContent = page.filePath || page.slug

    a.appendChild(title)
    a.appendChild(path)

    if (page.tags && page.tags.length > 0) {
      const tags = document.createElement("span")
      tags.className = "admin-tags"
      for (const tag of page.tags) {
        const chip = document.createElement("span")
        chip.className = "admin-tag"
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

async function loadDashboard() {
  const status = document.getElementById("admin-list-status")
  setStatus(status, "busy", "Loading pages…")

  try {
    const res = await fetch("/static/contentIndex.json", { cache: "no-cache" })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const raw = await res.json()
    const index: Record<string, ContentDetails> = raw?.content ?? raw

    allPages = Object.entries(index)
      .filter(([slug]) => isContentPage(slug))
      .map(([slug, details]) => ({ ...details, slug: details.slug ?? slug }))
      .sort((a, b) => (a.filePath || a.slug).localeCompare(b.filePath || b.slug))

    setStatus(status, "idle", "")
    renderList("")
  } catch (err) {
    setStatus(status, "error", `Could not load the page index: ${err}`)
  }

  const filter = document.getElementById("admin-filter") as HTMLInputElement | null
  filter?.addEventListener("input", () => renderList(filter.value))
}

// --- build status polling ----------------------------------------------------

const BUILD_POLL_MS = 5000
const BUILD_TIMEOUT_MS = 180000

/**
 * Wait until the deployed build reports the commit we just pushed.
 *
 * Polls the static build-info.json rather than the Vercel API: no extra token, no
 * extra account scope, no rate limit, and it measures the thing that actually
 * matters -- whether the change is visible -- rather than deployment state.
 */
async function waitForBuild(
  commit: string,
  onTick: (elapsedMs: number) => void,
): Promise<"live" | "timeout"> {
  const started = Date.now()
  while (Date.now() - started < BUILD_TIMEOUT_MS) {
    await new Promise((r) => setTimeout(r, BUILD_POLL_MS))
    onTick(Date.now() - started)
    try {
      const res = await fetch(`/static/build-info.json?t=${Date.now()}`, { cache: "no-store" })
      if (res.ok) {
        const info = await res.json()
        if (info?.commit === commit) return "live"
      }
    } catch {
      // Offline or mid-deploy; keep waiting until the timeout.
    }
  }
  return "timeout"
}

/**
 * Report the outcome of a save. Without the timeout branch, a failed production
 * build would present as an spinner that never resolves.
 */
async function reportSave(
  statusId: string,
  result: { commit: string | null; local?: boolean; slug?: string },
) {
  const status = document.getElementById(statusId)
  const detail = document.getElementById(`${statusId}-detail`)
  const link = result.slug ? ` <a href="/${result.slug}">Open the page</a>` : ""

  if (result.local || result.commit === "local" || result.commit === null) {
    setStatus(status, "ok", "Saved. The local dev server has already reloaded.")
    if (detail && result.slug) {
      detail.hidden = false
      detail.innerHTML = link
    }
    return
  }

  setStatus(status, "busy", "Committed. Building…")
  if (detail) {
    detail.hidden = false
    detail.textContent = `Commit ${result.commit.slice(0, 7)}. This usually takes under a minute.`
  }

  const outcome = await waitForBuild(result.commit, (elapsed) => {
    if (detail) {
      detail.textContent = `Commit ${result.commit!.slice(0, 7)} · building for ${Math.round(elapsed / 1000)}s…`
    }
  })

  if (outcome === "live") {
    setStatus(status, "ok", "Live.")
    if (detail) detail.innerHTML = link
  } else {
    setStatus(status, "error", "The build is taking longer than usual.")
    if (detail) {
      detail.innerHTML =
        "The change was committed, so nothing is lost. Check the " +
        '<a href="https://vercel.com/dashboard" target="_blank" rel="noreferrer">Vercel dashboard</a> ' +
        "for a failed build."
    }
  }
}

// --- new page ----------------------------------------------------------------

function knownFolders(): string[] {
  const set = new Set<string>(["content"])
  for (const page of allPages) {
    const fp = page.filePath
    if (!fp) continue
    const dir = fp.split("/").slice(0, -1).join("/")
    set.add(dir ? `content/${dir}` : "content")
  }
  return [...set].sort()
}

async function loadNewPage() {
  // The folder suggestions come from the existing content index.
  try {
    const res = await fetch("/static/contentIndex.json", { cache: "no-cache" })
    if (res.ok) {
      const raw = await res.json()
      const index: Record<string, ContentDetails> = raw?.content ?? raw
      allPages = Object.entries(index)
        .filter(([slug]) => isContentPage(slug))
        .map(([slug, d]) => ({ ...d, slug: d.slug ?? slug }))
      const datalist = document.getElementById("new-folder-options")
      if (datalist) {
        for (const folder of knownFolders()) {
          const opt = document.createElement("option")
          opt.value = folder
          datalist.appendChild(opt)
        }
      }
    }
  } catch {
    // Folder suggestions are a convenience; the field is free text regardless.
  }

  const form = document.getElementById("admin-new-form") as HTMLFormElement | null
  const title = document.getElementById("new-title") as HTMLInputElement | null
  const folder = document.getElementById("new-folder") as HTMLInputElement | null
  const tags = document.getElementById("new-tags") as HTMLInputElement | null
  const unlisted = document.getElementById("new-unlisted") as HTMLInputElement | null
  const body = document.getElementById("new-body") as HTMLTextAreaElement | null
  const file = document.getElementById("new-file") as HTMLInputElement | null
  const fileName = document.getElementById("new-file-name")
  const preview = document.getElementById("new-path-preview")
  const submit = document.getElementById("new-submit") as HTMLButtonElement | null
  const status = document.getElementById("new-status")
  if (!form || !title || !body) return

  // Mirrors safeName() in api/_lib/md.js so the author sees the real filename.
  const slugify = (v: string) =>
    v
      .normalize("NFKC")
      .normalize("NFD")
      .replace(/\p{M}/gu, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 80)

  // Prefill from /browse: "Create this page" on an unresolved wikilink links here
  // with the target name and a suggested folder, turning the broken-link list into
  // a work queue.
  const params = new URLSearchParams(location.search)
  const prefillTitle = params.get("title")
  const prefillFolder = params.get("folder")
  const prefillFrom = params.get("from")
  if (prefillTitle) title.value = prefillTitle
  if (prefillFolder && folder) folder.value = prefillFolder
  if (prefillFrom && !body.value) {
    body.value = "Referenced from [[" + prefillFrom.split("/").pop() + "]].\n\n"
  }

  const updatePreview = () => {
    if (!preview) return
    const stem = slugify(title.value)
    preview.textContent = stem
      ? `Will be saved as ${(folder?.value || "content").replace(/\/+$/, "")}/${stem}.md`
      : ""
  }
  title.addEventListener("input", updatePreview)
  folder?.addEventListener("input", updatePreview)

  file?.addEventListener("change", async () => {
    const chosen = file.files?.[0]
    if (!chosen) return
    const text = await chosen.text()
    body.value = text
    if (fileName) fileName.textContent = chosen.name
    if (!title.value) {
      title.value = chosen.name.replace(/\.(md|markdown|txt)$/i, "")
      updatePreview()
    }
  })

  form.addEventListener("submit", async (e) => {
    e.preventDefault()
    if (submit) submit.disabled = true
    setStatus(status, "busy", "Saving…")

    const result = await api("/api/pages", {
      method: "POST",
      body: {
        action: "create",
        title: title.value,
        folder: folder?.value || "content",
        tags: tags?.value ?? "",
        unlisted: unlisted?.checked === true,
        body: body.value,
      },
    })

    if (submit) submit.disabled = false

    if (!result.ok) {
      setStatus(status, "error", errorMessage(result, "Could not create the page."))
      const detail = document.getElementById("new-status-detail")
      if (detail && result.data?.path) {
        detail.hidden = false
        detail.textContent = `Conflicting file: ${result.data.path}`
      }
      return
    }

    await reportSave("new-status", result.data)
  })
}

// --- quick-add session notes -------------------------------------------------

const QUICK_DRAFT_KEY = "deyotlan-quick-draft"

interface QuickInfo {
  timeZone: string
  date: string
  time: string
  nextNumber: number
  existingToday: string | null
  mode: "create" | "append"
}

function readDraft(): string | null {
  try {
    const raw = localStorage.getItem(QUICK_DRAFT_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    return typeof parsed?.text === "string" && parsed.text.length > 0 ? parsed.text : null
  } catch {
    return null
  }
}

function writeDraft(text: string) {
  try {
    if (text.trim() === "") localStorage.removeItem(QUICK_DRAFT_KEY)
    else localStorage.setItem(QUICK_DRAFT_KEY, JSON.stringify({ text, at: Date.now() }))
  } catch {
    // Private browsing or a full quota. The textarea still holds the text for this
    // page view; only crash-recovery is lost.
  }
}

function clearDraft() {
  try {
    localStorage.removeItem(QUICK_DRAFT_KEY)
  } catch {
    /* nothing to do */
  }
}

function autoGrow(el: HTMLTextAreaElement) {
  el.style.height = "auto"
  el.style.height = Math.max(el.scrollHeight, 220) + "px"
}

async function loadQuickNote() {
  const form = document.getElementById("quick-form") as HTMLFormElement | null
  const body = document.getElementById("quick-body") as HTMLTextAreaElement | null
  const file = document.getElementById("quick-file") as HTMLInputElement | null
  const fileName = document.getElementById("quick-file-name")
  const sessionInput = document.getElementById("quick-session") as HTMLInputElement | null
  const dateInput = document.getElementById("quick-date") as HTMLInputElement | null
  const tags = document.getElementById("quick-tags") as HTMLInputElement | null
  const submit = document.getElementById("quick-submit") as HTMLButtonElement | null
  const status = document.getElementById("quick-status")
  const badge = document.getElementById("quick-mode-badge")
  const target = document.getElementById("quick-target")
  const draftBanner = document.getElementById("quick-draft-banner")
  const draftText = document.getElementById("quick-draft-text")
  if (!form || !body) return

  // Restore an unsent draft first. Table wifi is bad and phones kill backgrounded
  // tabs; losing a session's notes to a reload is the failure that would stop this
  // being used at all.
  const draft = readDraft()
  if (draft) {
    body.value = draft
    if (draftBanner) draftBanner.hidden = false
    if (draftText) draftText.textContent = "An unsaved draft was restored."
  }
  autoGrow(body)

  body.addEventListener("input", () => {
    writeDraft(body.value)
    autoGrow(body)
  })

  document.getElementById("quick-draft-discard")?.addEventListener("click", () => {
    body.value = ""
    clearDraft()
    autoGrow(body)
    if (draftBanner) draftBanner.hidden = true
    body.focus()
  })

  let info: QuickInfo | null = null

  const applyInfo = (i: QuickInfo) => {
    info = i
    if (badge) {
      badge.textContent = i.mode === "append" ? "Append to today" : `Session ${i.nextNumber}`
      badge.dataset.mode = i.mode
    }
    if (submit) {
      submit.textContent = i.mode === "append" ? "Append to today's note" : "Save session note"
    }
    if (sessionInput && !sessionInput.value) sessionInput.value = String(i.nextNumber)
    if (dateInput && !dateInput.value) dateInput.value = i.date
    if (target) {
      target.textContent =
        i.mode === "append"
          ? `Will append a "## ${i.time}" section to ${i.existingToday}`
          : `Will create session-${String(i.nextNumber).padStart(2, "0")}-${i.date}.md`
    }
  }

  const refresh = async () => {
    const r = await api<QuickInfo>("/api/session-note")
    if (r.ok && r.data) applyInfo(r.data)
    else setStatus(status, "error", errorMessage(r, "Could not read the session notes folder."))
  }
  await refresh()

  file?.addEventListener("change", async () => {
    const chosen = file.files?.[0]
    if (!chosen) return
    const text = await chosen.text()
    // Append rather than replace: an attachment during a session supplements what
    // has already been typed.
    body.value = body.value.trim()
      ? `${body.value.trimEnd()}

${text}`
      : text
    writeDraft(body.value)
    autoGrow(body)
    if (fileName) fileName.textContent = chosen.name
  })

  form.addEventListener("submit", async (e) => {
    e.preventDefault()
    if (body.value.trim() === "") {
      setStatus(status, "error", "There is nothing to save yet.")
      return
    }
    if (submit) submit.disabled = true
    setStatus(status, "busy", "Saving…")

    const sessionNumber = sessionInput?.value ? Number(sessionInput.value) : undefined
    const result = await api("/api/session-note", {
      method: "POST",
      body: {
        body: body.value,
        mode: info?.mode ?? "create",
        session: Number.isInteger(sessionNumber) ? sessionNumber : undefined,
        date: dateInput?.value || undefined,
        tags: tags?.value ?? "",
      },
    })

    if (submit) submit.disabled = false

    if (!result.ok) {
      // The draft is deliberately NOT cleared on failure.
      setStatus(status, "error", errorMessage(result, "Could not save the note."))
      return
    }

    clearDraft()
    body.value = ""
    autoGrow(body)
    if (draftBanner) draftBanner.hidden = true
    if (fileName) fileName.textContent = ""
    if (file) file.value = ""

    await reportSave("quick-status", result.data)
    await refresh()
  })
}

// --- boot --------------------------------------------------------------------

async function startPage() {
  const page = document.body.dataset.adminPage
  if (page === "dashboard") await loadDashboard()
  if (page === "new") await loadNewPage()
  if (page === "quick") await loadQuickNote()
}

async function boot() {
  initTheme()
  initLoginForm()
  initLogout()

  const session = await api<{ admin: boolean; dev?: boolean }>("/api/session")

  if (session.status === 0) {
    showLogin("No connection to the wiki API.")
    return
  }
  if (!session.ok || !session.data?.admin) {
    showLogin()
    return
  }

  if (session.data.dev) {
    const banner = document.getElementById("admin-dev-banner")
    if (banner) banner.hidden = false
  }

  showApp()
  await startPage()
}

void boot()

// The loader strips the two leading keywords below, leaving an inert string literal.
// TypeScript still needs the declaration so the emitter can import this file as text.
export default ""
