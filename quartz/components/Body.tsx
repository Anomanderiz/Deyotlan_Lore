import { QuartzComponent, QuartzComponentConstructor, QuartzComponentProps } from "./types"

const Body: QuartzComponent = ({ children }: QuartzComponentProps) => {
  return (
    <div id="quartz-body">
      <div class="mobile-topo-backdrop" aria-hidden="true">
        <div class="mobile-topo-backdrop__image" />
      </div>
      {children}
    </div>
  )
}

export default (() => Body) satisfies QuartzComponentConstructor
