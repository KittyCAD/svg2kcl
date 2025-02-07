import { XMLParser } from 'fast-xml-parser'
import { RawSVGElement } from '../types/svg'
import { GeometricShape } from '../types/geometric'
import { ShapeReader } from './shape'
import { PathReader } from './path'
import { SVG } from '../types/svg'
import { GeometricElementType } from '../types/geometric'
import { promises as fs } from 'node:fs'

export class SVGReadError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SVGReadError'
  }
}

export class BaseReader {
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
    return type === 'g'
  }

  private processElement(element: any, type: string): RawSVGElement[] {
    const elements: RawSVGElement[] = []

    // Handle direct geometric elements.
    if (this.isGeometricElement(type)) {
      elements.push({
        type: type as GeometricElementType,
        attributes: element
      })
      return elements
    }

    // Handle groups.
    if (this.isGroupElement(type)) {
      return this.extractElementsFromGroup(element)
    }

    return elements
  }

  private extractElementsFromGroup(group: any): RawSVGElement[] {
    const elements: RawSVGElement[] = []

    // Process all properties of the group.
    for (const [key, value] of Object.entries(group)) {
      // Skip non-element properties.
      if (typeof value !== 'object' || key.startsWith('@') || key === '#text') {
        continue
      }

      // Handle arrays of elements.
      if (Array.isArray(value)) {
        value.forEach((item) => {
          elements.push(...this.processElement(item, key))
        })
      }
      // Handle single elements.
      else {
        elements.push(...this.processElement(value, key))
      }
    }

    return elements
  }

  private extractElements(parsed: any): RawSVGElement[] {
    if (!parsed.svg) {
      throw new SVGReadError('No SVG element found')
    }

    return this.extractElementsFromGroup(parsed.svg)
  }

  private readElement(element: RawSVGElement): GeometricShape {
    if (element.type === 'path') {
      return this.pathReader.read(element)
    }
    return this.shapeReader.read(element)
  }

  private readString(content: string): SVG {
    const parsed = this.xmlParser.parse(content)

    if (!parsed.svg) {
      throw new SVGReadError('No SVG element found')
    }

    const rawElements = this.extractElements(parsed)
    const elements = rawElements.map((elem) => this.readElement(elem))

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
