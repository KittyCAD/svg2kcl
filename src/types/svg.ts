import { ViewBox } from './base'
import { Element } from './elements'

// Representation of an SVG doc and its elements.
export interface SVG {
  viewBox: ViewBox
  elements: Element[]
}

export interface RawSVGElement {
  type: string
  attributes: Record<string, string>
  children?: RawSVGElement[]
}

export interface RawSVG {
  viewBox?: string
  width?: string | number
  height?: string | number
  elements: RawSVGElement[]
}
