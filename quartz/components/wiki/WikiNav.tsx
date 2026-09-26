// DEYOTLAN: replacement for @quartz-community/explorer.
/**
 * Curated wiki navigation.
 *
 * Renders groups from `/static/nav.json` rather than from the folder tree, so a page
 * can appear under any heading without its file moving and without its URL changing.
 *
 * ## The DOM contract is not negotiable
 *
 * 36 rules across five stylesheets target the explorer's markup
 * (`deyotlan-glass.scss` x14, `mobile-navigation.scss` x13, `liquid-glass.scss` x5,
 * `mobile-glass.scss` x3, `glass-polish.scss` x1), and the whole mobile drawer is a
 * state machine keyed on `.collapsed` being toggled on `.explorer` --
 * `mobile-navigation.scss:95` says so explicitly and warns against replacing it.
 *
 * This component therefore emits byte-for-byte the same structure the community
 * explorer did: `.explorer.nav-files-container` > `.explorer-content` >
 * `ul.explorer-ul`, the two toggle buttons, and the two `<template>` elements. The
 * only additions are a `.wiki-nav` class for new styling hooks and `data-groupid`
 * in place of `data-folderpath` (existing selectors match the class, not the
 * attribute, so that swap is safe).
 *
 * Treat those 36 rules as the acceptance test for any change here.
 */
import { QuartzComponent, QuartzComponentConstructor, QuartzComponentProps } from "../types"
import wikiNavStyle from "../../styles/wiki-nav.scss"
import wikiNavScript from "../scripts/wiki-nav.inline"

export interface WikiNavOptions {
  /** Heading shown on the desktop toggle. */
  title: string
}

const defaultOptions: WikiNavOptions = {
  title: "Explorer",
}

export default ((userOpts?: Partial<WikiNavOptions>) => {
  const opts = { ...defaultOptions, ...userOpts }

  const WikiNav: QuartzComponent = ({ displayClass }: QuartzComponentProps) => {
    return (
      <div
        class={`explorer nav-files-container wiki-nav ${displayClass ?? ""}`}
        data-collapsed="open"
        data-savestate="true"
      >
        <button
          type="button"
          class="explorer-toggle mobile-explorer hide-until-loaded"
          data-mobile="true"
          aria-controls="wiki-nav-content"
          aria-label="Navigation"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="24"
            height="24"
            viewBox="0 0 24 24"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
            class="lucide-menu"
          >
            <line x1="4" x2="20" y1="12" y2="12" />
            <line x1="4" x2="20" y1="6" y2="6" />
            <line x1="4" x2="20" y1="18" y2="18" />
          </svg>
        </button>

        <button
          type="button"
          class="title-button explorer-toggle desktop-explorer"
          data-mobile="false"
          aria-expanded="true"
        >
          <h2>{opts.title}</h2>
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="14"
            height="14"
            viewBox="5 8 14 8"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
            class="fold"
          >
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </button>

        <div id="wiki-nav-content" class="explorer-content" aria-expanded="false" role="group">
          <ul class="explorer-ul" id="wiki-nav-ul">
            <li class="overflow-end" />
          </ul>
        </div>

        {/* Cloned by wiki-nav.inline.ts, exactly as the explorer did. */}
        <template id="template-file">
          <li>
            <a href="#" class="nav-file-title tree-item-self" />
          </li>
        </template>
        <template id="template-folder">
          <li>
            <div class="folder-container nav-folder-title tree-item-self">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="12"
                height="12"
                viewBox="5 8 14 8"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
                class="folder-icon nav-folder-collapse-indicator collapse-icon"
              >
                <polyline points="6 9 12 15 18 9" />
              </svg>
              <div>
                <button class="folder-button">
                  <span class="folder-title" />
                </button>
              </div>
            </div>
            <div class="folder-outer">
              <ul class="content tree-item-children" />
            </div>
          </li>
        </template>
      </div>
    )
  }

  WikiNav.displayName = "WikiNav"
  WikiNav.css = wikiNavStyle
  WikiNav.afterDOMLoaded = wikiNavScript
  return WikiNav
}) satisfies QuartzComponentConstructor<Partial<WikiNavOptions> | undefined>
