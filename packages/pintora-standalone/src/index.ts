import pintora, { configApi, GraphicsIR } from '@pintora/core'
export * from '@pintora/core'
import { DIAGRAMS, DiagramsConf, THEMES, ITheme } from '@pintora/diagrams'
import { render, RenderOptions, BaseRenderer, rendererRegistry } from '@pintora/renderer'

function initDiagrams() {
  Object.keys(DIAGRAMS).forEach(name => {
    pintora.diagramRegistry.registerDiagram(name, DIAGRAMS[name])
  })
}
initDiagrams()

export type PintoraConfig = DiagramsConf & {
  core: {
    /** by default it's 'svg' */
    defaultRenderer: string
  }
}

type DeepPartial<T> = {
  [P in keyof T]?: DeepPartial<T[P]>
}

configApi.setConfig<PintoraConfig>({
  core: {
    defaultRenderer: 'svg',
  },
})

type InitBrowserOptions = {
  startOnLoad?: boolean
}
interface RenderToOptions extends RenderOptions {
  onError?(error: Error): void
  enhanceGraphicIR?(ir: GraphicsIR): GraphicsIR
}

const CLASSES = {
  wrapper: 'pintora-wrapper',
}

const pintoraStandalone = {
  ...pintora,
  renderTo(code: string, options: RenderToOptions) {
    const { container } = options
    let ctn: HTMLDivElement
    if (typeof container === 'string') {
      ctn = document.querySelector(container) as any
    } else {
      ctn = container
    }

    let drawResult: ReturnType<typeof pintoraStandalone.parseAndDraw>
    try {
      drawResult = pintoraStandalone.parseAndDraw(code, options)
    } catch (error) {
      const onError = options.onError || console.warn
      onError(error)
    }

    if (drawResult) {
      let graphicIR = drawResult.graphicIR
      if (options.enhanceGraphicIR) graphicIR = options.enhanceGraphicIR(graphicIR)
      if (!graphicIR.bgColor) {
        const conf = configApi.getConfig<PintoraConfig>()
        const canvasBackground = conf.themeConfig.themeVariables?.canvasBackground
        if (canvasBackground) graphicIR.bgColor = canvasBackground
      }

      render(graphicIR, options)
    }
  },
  /**
   * Init in browser
   */
  initBrowser(options: InitBrowserOptions = {}) {
    // if (options.startOnLoad) {
    // }

    const selector = '.pintora'
    const containers = document.querySelectorAll(selector)
    containers.forEach((container: HTMLDivElement) => {
      pintoraStandalone.renderContentOf(container)
    })
  },
  renderContentOf(container: HTMLDivElement) {
    const prevSibling = container.previousElementSibling
    if (prevSibling && prevSibling.classList.contains(CLASSES.wrapper)) {
      prevSibling.remove()
    }

    const wrapper = document.createElement('div')
    wrapper.classList.add(CLASSES.wrapper)
    container.style.display = 'none'

    const renderer: any =
      container.dataset.renderer || configApi.getConfig<PintoraConfig>().core?.defaultRenderer || 'svg'

    container.parentNode.insertBefore(wrapper, container)
    pintoraStandalone.renderTo(container.innerText, {
      container: wrapper,
      renderer,
    })
  },
  getConfig: configApi.getConfig,
  setConfig(c: DeepPartial<DiagramsConf>) {
    configApi.setConfig(c)
    if (c.themeConfig?.theme) {
      const conf = configApi.getConfig<PintoraConfig>()
      const newConf = { ...conf }
      const themeVars = THEMES[c.themeConfig.theme]
      const configThemeVars = c.themeConfig.themeVariables
      if (themeVars) {
        newConf.themeConfig = newConf.themeConfig || ({} as any)
        newConf.themeConfig.themeVariables = { ...themeVars }
      }
      if (configThemeVars) {
        Object.assign(newConf.themeConfig.themeVariables, configThemeVars)
      }
      configApi.setConfig(newConf)
    }
  },
  registerTheme(name: string, variables: ITheme) {
    if (THEMES[name]) {
      console.warn(`[pintora] override theme ${name}`)
    }
    THEMES[name] = variables
  },
}

export { BaseRenderer, rendererRegistry, DiagramsConf, ITheme, THEMES }

export { pintoraStandalone } // for @pintora/cli

export default pintoraStandalone
