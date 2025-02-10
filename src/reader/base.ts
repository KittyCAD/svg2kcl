import { XMLParser } from 'fast-xml-parser'
import { promises as fs } from 'node:fs'
import { RawSVGElement, SVG } from '../types/svg'
import { ElementType, Element, GroupElement } from '../types/elements'
import { PathReader } from './path'
import { ShapeReader } from './shape'
import { Transform } from '../utils/transform'

export class SVGReadError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SVGReadError'
  }
}

export class SVGReader {
  private xmlParser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: ''
  })

  private shapeReader = new ShapeReader()
  private pathReader = new PathReader()

  private isGeometricElement(type: string): boolean {
    return Object.values(ElementType).includes(type as ElementType)
  }

  private isGroupElement(type: string): boolean {
    return type === ElementType.Group
  }

  private readGroup(element: RawSVGElement): GroupElement {
    return {
      type: ElementType.Group,
      children: element.children ? element.children.map((child) => this.readElement(child)) : [],
      transform: element.attributes.transform
        ? Transform.fromString(element.attributes.transform)
        : new Transform(),
      parent: null // Will be set by parent element.
    }
  }

  private processElement(element: any, type: string, parent?: RawSVGElement): RawSVGElement[] {
    const elements: RawSVGElement[] = []

    // Handle groups and geometric elements
    if (this.isGeometricElement(type) || this.isGroupElement(type)) {
      const rawElement: RawSVGElement = {
        type: type as ElementType,
        attributes: element,
        children: [],
        parent
      }

      // Process children if this is a group
      if (this.isGroupElement(type)) {
        rawElement.children = this.extractElementsFromGroup(element, rawElement)
      }

      elements.push(rawElement)
    }

    return elements
  }

  private extractElementsFromGroup(group: any, parent: RawSVGElement): RawSVGElement[] {
    const elements: RawSVGElement[] = []

    // Process all properties of the group
    for (const [key, value] of Object.entries(group)) {
      // Skip non-element properties.
      if (typeof value !== 'object' || key.startsWith('@') || key === '#text') {
        continue
      }

      // Handle arrays of elements.
      if (Array.isArray(value)) {
        value.forEach((item) => {
          elements.push(...this.processElement(item, key, parent))
        })
      }
      // Handle single elements.
      else {
        elements.push(...this.processElement(value, key, parent))
      }
    }

    return elements
  }

  private extractElements(parsed: any): RawSVGElement[] {
    if (!parsed.svg) {
      throw new SVGReadError('No SVG element found')
    }

    // Create root SVG element
    const svgElement: RawSVGElement = {
      type: 'svg',
      attributes: parsed.svg,
      children: [],
      parent: undefined
    }

    // Process all child elements
    svgElement.children = this.extractElementsFromGroup(parsed.svg, svgElement)

    return [svgElement]
  }

  private flattenGeometricElements(element: RawSVGElement): RawSVGElement[] {
    let elements: RawSVGElement[] = []

    // Add this element if it's a geometric element
    if (this.isGeometricElement(element.type)) {
      elements.push(element)
    }

    // Recursively process children
    if (element.children) {
      for (const child of element.children) {
        elements = elements.concat(this.flattenGeometricElements(child))
      }
    }

    return elements
  }

  private readElement(element: RawSVGElement, parent: Element | null = null): Element {
    let output: Element

    switch (element.type) {
      case ElementType.Group:
        const groupElement = this.readGroup(element)
        groupElement.parent = parent
        // Recursively set parent for all children
        groupElement.children = groupElement.children.map((child) => {
          child.parent = groupElement
          return child
        })
        output = groupElement
        break
      case ElementType.Path:
        const pathElement = this.pathReader.read(element)
        pathElement.parent = parent
        output = pathElement
        break
      default:
        const shapeElement = this.shapeReader.read(element)
        shapeElement.parent = parent
        output = shapeElement
        break
    }

    return output
  }

  private readString(content: string): SVG {
    const parsed = this.xmlParser.parse(content)

    if (!parsed.svg) {
      throw new SVGReadError('No SVG element found')
    }

    // Extract full element hierarchy
    const [rootElement] = this.extractElements(parsed)

    // Convert to geometric shapes starting from root, building parent-child relationships
    const elements = rootElement.children!.map((elem) => this.readElement(elem, null))

    // Handle viewBox parsing.
    let viewBox = { xMin: 0, yMin: 0, width: 0, height: 0 }

    if (parsed.svg.viewBox) {
      const viewBoxValues = parsed.svg.viewBox.split(/[\s,]+/).map(Number)
      if (viewBoxValues.length === 4) {
        viewBox = {
          xMin: viewBoxValues[0],
          yMin: viewBoxValues[1],
          width: viewBoxValues[2],
          height: viewBoxValues[3]
        }
      }
    } else {
      viewBox = {
        xMin: 0,
        yMin: 0,
        width: Number(parsed.svg.width) || 0,
        height: Number(parsed.svg.height) || 0
      }
    }

    return {
      viewBox,
      elements
    }
  }

  public async readFile(filepath: string): Promise<SVG> {
    try {
      const content = await fs.readFile(filepath, 'utf8')
      return this.readString(content)
    } catch (error) {
      throw new SVGReadError(`Failed to read SVG file ${filepath}: ${error}`)
    }
  }
}
