const observedExplorers = new WeakSet<Element>()

function readSavedFolderState(): Map<string, boolean> {
  try {
    const entries = JSON.parse(localStorage.getItem("fileTree") ?? "[]") as Array<{
      path?: string
      collapsed?: boolean
    }>

    return new Map(
      entries
        .filter((entry) => typeof entry.path === "string")
        .map((entry) => [entry.path!, entry.collapsed === true]),
    )
  } catch {
    return new Map()
  }
}

function applyExplorerDefaults(explorer: HTMLElement) {
  if (explorer.dataset.collapsed !== "open") return

  const useSavedState = explorer.dataset.savestate === "true"
  const savedState = useSavedState ? readSavedFolderState() : new Map<string, boolean>()

  for (const folder of explorer.querySelectorAll<HTMLElement>(".folder-container")) {
    const folderContents = folder.nextElementSibling
    if (
      !(folderContents instanceof HTMLElement) ||
      !folderContents.classList.contains("folder-outer")
    ) {
      continue
    }

    const savedCollapsed = savedState.get(folder.dataset.folderpath ?? "")
    if (!useSavedState || savedCollapsed === undefined || savedCollapsed === false) {
      folderContents.classList.add("open")
    }
  }
}

function observeExplorerDefaults() {
  for (const explorer of document.querySelectorAll<HTMLElement>(".explorer")) {
    if (observedExplorers.has(explorer)) continue
    observedExplorers.add(explorer)

    const tree = explorer.querySelector(".explorer-ul")
    if (!tree) continue

    applyExplorerDefaults(explorer)
    new MutationObserver(() => applyExplorerDefaults(explorer)).observe(tree, {
      childList: true,
      subtree: true,
    })
  }
}

observeExplorerDefaults()
document.addEventListener("nav", observeExplorerDefaults)
