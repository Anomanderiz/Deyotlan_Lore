import { PageFrame, PageFrameProps } from "./types"
import HeaderConstructor from "../Header"

const Header = HeaderConstructor()

/**
 * The default page frame — three-column layout with left sidebar, center
 * content (header + body + afterBody), and right sidebar, followed by a footer.
 *
 * This is the original Quartz layout, extracted from renderPage.tsx.
 */
export const DefaultFrame: PageFrame = {
  name: "default",
  render({
    componentData,
    header,
    beforeBody,
    pageBody: Content,
    afterBody,
    left,
    right,
    footer,
  }: PageFrameProps) {
    return (
      <>
        {/*
         * Hidden SVG reference filter for live glass refraction.
         * In Chromium/Edge it is referenced directly from backdrop-filter,
         * making SourceGraphic the captured backdrop behind the pane.
         * One low-frequency octave gives broad, smooth optical warping rather
         * than a noisy/textured surface.
         */}
        <svg
          class="deyotlan-glass-filter-defs"
          width="0"
          height="0"
          aria-hidden="true"
          focusable="false"
        >
          <defs>
            <filter
              id="deyotlan-glass-refraction"
              x="-24%"
              y="-24%"
              width="148%"
              height="148%"
              color-interpolation-filters="sRGB"
            >
              <feTurbulence
                type="fractalNoise"
                baseFrequency="0.006 0.018"
                numOctaves="1"
                seed="11"
                stitchTiles="stitch"
                result="glassNoise"
              />
              <feDisplacementMap
                in="SourceGraphic"
                in2="glassNoise"
                scale="20"
                xChannelSelector="R"
                yChannelSelector="G"
              />
            </filter>
          </defs>
        </svg>

        <div class="left sidebar">
          {left.map((BodyComponent) => (
            <BodyComponent {...componentData} />
          ))}
        </div>
        <div class="center">
          <div class="page-header">
            <Header {...componentData}>
              {header.map((HeaderComponent) => (
                <HeaderComponent {...componentData} />
              ))}
            </Header>
            <div class="popover-hint">
              {beforeBody.map((BodyComponent) => (
                <BodyComponent {...componentData} />
              ))}
            </div>
          </div>
          <Content {...componentData} />
          <hr />
          <div class="page-footer">
            {afterBody.map((BodyComponent) => (
              <BodyComponent {...componentData} />
            ))}
          </div>
        </div>
        <div class="right sidebar">
          {right.map((BodyComponent) => (
            <BodyComponent {...componentData} />
          ))}
        </div>
        {footer.map((FooterComponent) => (
          <FooterComponent {...componentData} />
        ))}
      </>
    )
  },
}
