// DEYOTLAN: per-page tag chips that feed the /browse filter.
/**
 * Replaces the disabled `@quartz-community/tag-list` with chips that lead somewhere
 * useful. A single-tag page is a dead end; these link into /browse with the tag
 * pre-selected, so the obvious next action -- narrow by a second tag -- is one tap
 * away. The canonical single-tag permalink at /tags/<tag> is still reachable from
 * there, and `@quartz-community/tag-page` continues to generate it.
 */
import { QuartzComponent, QuartzComponentConstructor, QuartzComponentProps } from "../types"
import wikiTagsStyle from "../../styles/wiki-tags.scss"

const WikiTags: QuartzComponent = ({ fileData, displayClass }: QuartzComponentProps) => {
  const tags = fileData.frontmatter?.tags
  if (!Array.isArray(tags) || tags.length === 0) return null

  return (
    <div class={`wiki-tags ${displayClass ?? ""}`}>
      <h3>Tags</h3>
      <ul>
        {tags.map((tag: string) => (
          <li key={tag}>
            <a
              class="wiki-tag-chip"
              href={`/browse?tags=${encodeURIComponent(tag)}`}
              title={`Browse pages tagged ${tag}`}
            >
              {tag}
            </a>
          </li>
        ))}
      </ul>
      <a class="wiki-tags-all" href="/browse">
        Browse all tags
      </a>
    </div>
  )
}

WikiTags.displayName = "WikiTags"
WikiTags.css = wikiTagsStyle

export default (() => WikiTags) satisfies QuartzComponentConstructor
