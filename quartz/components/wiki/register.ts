// DEYOTLAN: registers first-party components that are not npm plugins.
//
// The layout is assembled from plugin entries resolved through componentRegistry by
// extractPluginName(entry.source). A bare string source falls through every branch of
// that function and is returned unchanged (config-loader.ts:79), so registering under
// a bare name is enough for a synthetic layout entry to find the component.
import { componentRegistry } from "../registry"
import WikiNav from "./WikiNav"
import WikiTags from "./WikiTags"

let registered = false

export function registerLocalComponents(): void {
  if (registered) return
  registered = true

  // Both spellings: buildLayoutForEntries looks up the bare name first and falls back
  // to a PascalCase conversion of it.
  componentRegistry.register("wiki-nav", WikiNav, "deyotlan-local")
  componentRegistry.register("WikiNav", WikiNav, "deyotlan-local")
  componentRegistry.register("wiki-tags", WikiTags, "deyotlan-local")
  componentRegistry.register("WikiTags", WikiTags, "deyotlan-local")
}
