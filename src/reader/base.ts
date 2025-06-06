import { XMLParser } from 'fast-xml-parser'
import { promises as fs } from 'node:fs'
import { Element, ElementType, GroupElement } from '../types/elements'
import { RawSvgElement, Svg } from '../types/svg'
import { Transform } from '../utils/transform'
import { PathReader } from './path'
import { ShapeReader } from './shape'

export class SvgReadError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SvgReadError'
  }
}

export class SvgReader {
  private xmlParser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: ''
  })

  private shapeReader = new ShapeReader()
  private pathReader = new PathReader()

  private isGeometricElement(type: string): boolean {
    return Object.values(ElementType).includes(type as ElementType) && type !== ElementType.Group
  }

  private isGroupElement(type: string): boolean {
    return type === ElementType.Group
  }

  private readGroup(element: RawSvgElement): GroupElement {
    return {
      type: ElementType.Group,
      children: element.children ? element.children.map((child) => this.readElement(child)) : [],
      transform: element.attributes.transform
        ? Transform.fromString(element.attributes.transform)
        : new Transform()
    }
  }

  private processElement(element: any, type: string): RawSvgElement[] {
    const elements: RawSvgElement[] = []

    // If element is an array of direct children (common in parsed SVGs)
    if (Array.isArray(element)) {
      element.forEach((child) => {
        elements.push(...this.processElement(child, type))
      })
      return elements
    }

    // Handle groups and geometric elements
    if (this.isGeometricElement(type) || this.isGroupElement(type)) {
      const rawElement: RawSvgElement = {
        type: type as ElementType,
        attributes: element,
        children: []
      }

      // Process children if this is a group
      if (this.isGroupElement(type)) {
        rawElement.children = this.extractElementsFromGroup(element)
      }

      elements.push(rawElement)
    }

    return elements
  }

  private extractElementsFromGroup(group: any): RawSvgElement[] {
    const elements: RawSvgElement[] = []

    // Process all properties of the group
    for (const [key, value] of Object.entries(group)) {
      // Skip non-element properties
      if (typeof value !== 'object' || key === '@' || key === '#text') {
        continue
      }

      // Handle arrays of elements
      if (Array.isArray(value)) {
        value.forEach((item) => {
          elements.push(...this.processElement(item, key))
        })
      }
      // Handle single elements
      else if (key !== 'viewBox' && key !== 'xmlns') {
        // Skip SVG attributes
        elements.push(...this.processElement(value, key))
      }
    }

    return elements
  }

  private extractElements(parsed: any): RawSvgElement[] {
    if (!parsed.svg) {
      throw new SvgReadError('No SVG element found')
    }

    // Create root SVG element
    const svgElement: RawSvgElement = {
      type: 'svg',
      attributes: parsed.svg,
      children: []
    }

    // Process all child elements
    svgElement.children = this.extractElementsFromGroup(parsed.svg)

    return [svgElement]
  }

  private readElement(element: RawSvgElement): Element {
    let output: Element

    switch (element.type) {
      case ElementType.Group:
        const groupElement = this.readGroup(element)
        groupElement.children = groupElement.children.map((child) => {
          return child
        })
        output = groupElement
        break
      case ElementType.Path:
        const pathElement = this.pathReader.read(element)
        output = pathElement
        break
      default:
        const shapeElement = this.shapeReader.read(element)
        output = shapeElement
        break
    }

    return output
  }

  public readString(content: string): Svg {
    const parsed = this.xmlParser.parse(content)

    if (!parsed.svg) {
      throw new SvgReadError('No SVG element found')
    }

    // Extract full element hierarchy
    const [rootElement] = this.extractElements(parsed)

    // Convert to geometric shapes starting from root, building parent-child relationships
    const elements = rootElement.children!.map((elem) => this.readElement(elem))

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

  public async readFile(filepath: string): Promise<Svg> {
    try {
      const content = await fs.readFile(filepath, 'utf8')
      return this.readString(content)
    } catch (error) {
      throw new SvgReadError(`Failed to read Svg file ${filepath}: ${error}`)
    }
  }
}
