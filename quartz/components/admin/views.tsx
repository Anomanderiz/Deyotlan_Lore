/**
 * Static markup for each admin view.
 *
 * These are rendered to HTML at build time and then populated at runtime by
 * admin.inline.ts. Keeping the skeleton server-rendered means the layout is painted
 * immediately and only the data-dependent regions wait on a fetch.
 */
import { AdminChrome } from "./AdminDocument"

/** Shared status strip: "Committed -> Building -> Live", or an error. */
function SaveStatus({ id }: { id: string }) {
  return (
    <div class="admin-save-status">
      <p class="admin-status" id={id} role="status" aria-live="polite" />
      <p class="admin-hint" id={`${id}-detail`} hidden />
    </div>
  )
}

export function DashboardView() {
  return (
    <div class="admin-shell">
      <AdminChrome current="dashboard" />

      <div class="admin-banner" id="admin-dev-banner" hidden>
        Running against the local filesystem. Changes appear immediately and are not committed to
        git.
      </div>

      <section class="admin-panel">
        <h2>
          Pages
          <span class="admin-count" id="admin-page-count" />
        </h2>
        <label class="admin-field">
          <span class="visually-hidden">Filter pages</span>
          <input
            type="search"
            id="admin-filter"
            placeholder="Filter by title, path or tag…"
            autocomplete="off"
          />
        </label>
        <p class="admin-status" id="admin-list-status" role="status" aria-live="polite" />
        <ul class="admin-list" id="admin-list" />
      </section>
    </div>
  )
}

export function NewPageView() {
  return (
    <div class="admin-shell">
      <AdminChrome current="new" />

      <div class="admin-banner" id="admin-dev-banner" hidden>
        Running against the local filesystem. Changes appear immediately and are not committed to
        git.
      </div>

      <form id="admin-new-form" autocomplete="off">
        <section class="admin-panel">
          <h2>New page</h2>

          <label class="admin-field">
            <span>Title</span>
            <input type="text" id="new-title" required placeholder="The Celestial Twins" />
          </label>
          <p class="admin-hint" id="new-path-preview" />

          <label class="admin-field">
            <span>Folder</span>
            <input
              type="text"
              id="new-folder"
              list="new-folder-options"
              value="content"
              spellcheck={false}
            />
            <datalist id="new-folder-options" />
          </label>

          <label class="admin-field">
            <span>Tags</span>
            <input type="text" id="new-tags" placeholder="lore, fey, politics" />
          </label>

          <label class="admin-field admin-checkbox">
            <input type="checkbox" id="new-unlisted" />
            <span>Unlisted — build the page but keep it out of listings</span>
          </label>
        </section>

        <section class="admin-panel">
          <h2>Content</h2>
          <div class="admin-actions" style="margin-bottom:0.75rem">
            <label class="admin-file-button">
              <input type="file" id="new-file" accept=".md,.markdown,.txt,text/markdown" />
              <span>Attach a .md file</span>
            </label>
            <span class="admin-hint" id="new-file-name" />
          </div>
          <label class="admin-field">
            <span class="visually-hidden">Markdown</span>
            <textarea
              id="new-body"
              rows={16}
              placeholder={"Paste markdown here.\n\nFrontmatter is merged, not duplicated."}
            />
          </label>
          <p class="admin-hint">
            A leading <code># Heading</code> is used as the title and removed, so it is not shown
            twice.
          </p>
        </section>

        <section class="admin-panel">
          <div class="admin-actions">
            <button type="submit" class="primary big" id="new-submit">
              Create page
            </button>
          </div>
          <SaveStatus id="new-status" />
        </section>
      </form>
    </div>
  )
}

export function QuickNoteView() {
  return (
    <div class="admin-shell admin-shell-quick">
      <AdminChrome current="quick" />

      <div class="admin-banner" id="admin-dev-banner" hidden>
        Running against the local filesystem. Changes appear immediately and are not committed to
        git.
      </div>

      <div class="admin-banner admin-banner-draft" id="quick-draft-banner" hidden>
        <span id="quick-draft-text">An unsaved draft was restored.</span>
        <button type="button" id="quick-draft-discard" class="admin-linkish">
          Discard it
        </button>
      </div>

      <form id="quick-form" autocomplete="off">
        <section class="admin-panel admin-panel-quick">
          <div class="quick-head">
            <h2 id="quick-heading">Session notes</h2>
            <span class="quick-badge" id="quick-mode-badge" />
          </div>

          <label class="admin-field">
            <span class="visually-hidden">Session notes</span>
            <textarea
              id="quick-body"
              class="quick-textarea"
              rows={12}
              autofocus
              placeholder={
                "Dump notes here as they happen.\n\n" +
                "Saved locally as you type, so a dropped connection or a reloaded tab will not " +
                "lose anything."
              }
            />
          </label>

          <div class="admin-actions">
            <label class="admin-file-button">
              <input type="file" id="quick-file" accept=".md,.markdown,.txt,text/markdown" />
              <span>Attach a .md file</span>
            </label>
            <span class="admin-hint" id="quick-file-name" />
          </div>
        </section>

        <details class="admin-panel admin-details" id="quick-details">
          <summary>Details</summary>
          <div class="admin-details-body">
            <label class="admin-field">
              <span>Session number</span>
              <input type="number" id="quick-session" min="1" step="1" />
            </label>
            <label class="admin-field">
              <span>Date</span>
              <input type="date" id="quick-date" />
            </label>
            <label class="admin-field">
              <span>Extra tags</span>
              <input type="text" id="quick-tags" placeholder="combat, quil-na-sko" />
            </label>
            <p class="admin-hint" id="quick-target" />
          </div>
        </details>

        <div class="quick-actions">
          <button type="submit" class="primary big" id="quick-submit">
            Save session note
          </button>
          <div class="admin-save-status">
            <p class="admin-status" id="quick-status" role="status" aria-live="polite" />
            <p class="admin-hint" id="quick-status-detail" hidden />
          </div>
        </div>
      </form>
    </div>
  )
}

/**
 * Public tag-browsing surface.
 *
 * Renders no chrome from the site because it is emitted standalone; it links back
 * instead. Everything is computed client-side from the content index that every page
 * already loads, so this costs nothing at build time.
 */
export function BrowseView() {
  return (
    <div class="admin-shell browse-shell">
      <header class="admin-topbar">
        <h1 class="admin-brand">
          Browse <span class="admin-brand-sub">by tag</span>
        </h1>
        <div class="admin-topbar-spacer" />
        <button
          type="button"
          class="admin-icon-button"
          id="admin-theme-toggle"
          title="Toggle theme"
        >
          <span aria-hidden="true">◐</span>
          <span class="visually-hidden">Toggle light and dark theme</span>
        </button>
        <a class="admin-icon-button browse-back" href="/">
          Back to the wiki
        </a>
      </header>

      <section class="admin-panel">
        <div class="browse-controls">
          <label class="admin-field browse-search">
            <span class="visually-hidden">Filter the tag list</span>
            <input
              type="search"
              id="browse-tag-filter"
              placeholder="Find a tag..."
              autocomplete="off"
            />
          </label>
          <div class="browse-mode" role="radiogroup" aria-label="How to combine tags">
            <button
              type="button"
              id="browse-mode-and"
              class="is-active"
              role="radio"
              aria-checked="true"
            >
              All of
            </button>
            <button type="button" id="browse-mode-or" role="radio" aria-checked="false">
              Any of
            </button>
          </div>
          <button type="button" id="browse-clear" class="browse-clear" hidden>
            Clear
          </button>
        </div>
        <div class="browse-tags" id="browse-tags" role="group" aria-label="Tags" />
      </section>

      <section class="admin-panel">
        <h2>
          Pages
          <span class="admin-count" id="browse-count" />
        </h2>
        <p class="admin-status" id="browse-status" role="status" aria-live="polite" />
        <ul class="admin-list" id="browse-results" />
      </section>

      <details class="admin-panel admin-details" id="browse-orphans-panel">
        <summary>
          Links to pages that do not exist yet
          <span class="admin-count" id="browse-orphan-count" />
        </summary>
        <div class="admin-details-body">
          <p class="admin-hint">
            Wikilinks pointing at notes that have never been written. For an admin, each one can be
            turned into a page.
          </p>
          <ul class="admin-list" id="browse-orphans" />
        </div>
      </details>
    </div>
  )
}
