import { ViewBox } from './base'
import { Element } from './elements'

// Representation of an SVG doc and its elements.
export interface Svg {
  viewBox: ViewBox
  elements: Element[]
}

export interface RawSvgElement {
  type: string
  attributes: Record<string, string>
  children?: RawSvgElement[]
}

export interface RawSvg {
  viewBox?: string
  width?: string | number
  height?: string | number
  elements: RawSvgElement[]
}
