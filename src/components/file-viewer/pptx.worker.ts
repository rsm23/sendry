import { parse } from '@pagus-kit/core'
import { buildFontSubstitutes, renderSlide } from '@pagus-kit/renderer'

self.onmessage = async (event: MessageEvent<ArrayBuffer>) => {
  try {
    const presentation = await parse(event.data)
    if (presentation.slides.length > 500) throw new Error('Presentation exceeds the safe 500 slide limit')
    const fontSubstitutes = buildFontSubstitutes(presentation.fonts)
    let nodes = 0
    const slides = presentation.slides.map((slide, index) => {
      const rendered = renderSlide(slide, presentation.slideSize, { fontSubstitutes })
      nodes += (rendered.svg.match(/</g) ?? []).length
      if (nodes > 200_000 || rendered.svg.length > 50 * 1024 * 1024) throw new Error('Presentation exceeds the safe rendering complexity limit')
      return { index: index + 1, svg: rendered.svg, width: rendered.width, height: rendered.height, text: rendered.svg.replace(/<[^>]+>/g, ' ') }
    })
    self.postMessage({ slides })
  } catch (error) {
    self.postMessage({ error: error instanceof Error ? error.message : 'Presentation parsing failed' })
  }
}
