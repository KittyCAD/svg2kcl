import { XMLParser } from 'fast-xml-parser'
import { promises as fs } from 'node:fs'
import { GeometricElementType, GeometricShape, GeometricElement } from '../types/geometric'
import { CollectionType, RawSVGElement, SVG } from '../types/svg'
import { PathReader } from './path'
import { ShapeReader } from './shape'

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
    return Object.values(GeometricElementType).includes(type as GeometricElementType)
  }

  private isGroupElement(type: string): boolean {
    return type === CollectionType.Group
  }

  private processElement(element: any, type: string, parent?: RawSVGElement): RawSVGElement[] {
    const elements: RawSVGElement[] = []

    // Handle direct geometric elements.
    if (this.isGeometricElement(type)) {
      const rawElement: RawSVGElement = {
        type: type as GeometricElementType,
        attributes: element,
        children: [],
        parent
      }
      elements.push(rawElement)
      return elements
    }

    // Handle groups.
    if (this.isGroupElement(type)) {
      const groupElement: RawSVGElement = {
        type: CollectionType.Group,
        attributes: element,
        children: [],
        parent
      }

      // Process group children and set their parent.
      const childElements = this.extractElementsFromGroup(element, groupElement)
      groupElement.children = childElements
      elements.push(groupElement)
      return elements
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

  private readElement(element: RawSVGElement): GeometricShape {
    if (element.type === GeometricElementType.Path) {
      return this.pathReader.read(element)
    }
    return this.shapeReader.read(element)
  }

  private readString(content: string): SVG {
    const parsed = this.xmlParser.parse(content)

    if (!parsed.svg) {
      throw new SVGReadError('No SVG element found')
    }

    // Extract full element hierarchy.
    const [rootElement] = this.extractElements(parsed)

    // Flatten to get only geometric elements while maintaining parent links.
    const geometricElements = this.flattenGeometricElements(rootElement)

    // Convert to geometric shapes.
    const elements = geometricElements.map((elem) => this.readElement(elem))

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
