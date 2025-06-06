import { ViewBox } from './base'
import { Element } from './elements'

// Representation of an SVG doc and its elements.
export type Svg = {
  viewBox: ViewBox
  elements: Element[]
}

export type RawSvgElement = {
  type: string
  attributes: Record<string, string>
  children?: RawSvgElement[]
}

export type RawSvg = {
  viewBox?: string
  width?: string | number
  height?: string | number
  elements: RawSvgElement[]
}
