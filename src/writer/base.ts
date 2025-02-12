import { Element, ElementType } from '../types/elements'
import { KclOptions, KclOutput } from '../types/kcl'
import { Svg } from '../types/svg'
import { Transform, getCombinedTransform } from '../utils/transform'
import { Converter } from './converter'
import { Formatter } from './formatter'

export class KclWriteError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'KclWriteError'
  }
}

export class KclWriter {
  private variableCounter = 1
  private converter: Converter
  private formatter: Formatter

  constructor(private svg: Svg, private options: KclOptions = {}) {
    this.converter = new Converter(options, svg.viewBox)
    this.formatter = new Formatter()
  }

  private generateVariableName(): string {
    return `sketch${String(this.variableCounter++).padStart(3, '0')}`
  }

  private flattenElements(elements: Element[]): Element[] {
    // Flattens elements and combines their transforms correctly.
    const flattened: Element[] = []

    const processElement = (element: Element) => {
      if (element.type === ElementType.Group) {
        // Process each child of the group.
        element.children.forEach((child) => processElement(child))
      } else {
        // Get combined transform using utility function.
        const combinedTransform = getCombinedTransform(elements, element)

        // Add the element with its combined transform.
        flattened.push({
          ...element,
          transform: combinedTransform
        })
      }
    }

    // Process all root elements.
    elements.forEach((element) => processElement(element))
    return flattened
  }

  public write(): string {
    try {
      const output: KclOutput = { shapes: [] }
      const flatElements = this.flattenElements(this.svg.elements)

      for (const element of flatElements) {
        const operations = this.converter.convertElement(element)
        if (operations.length > 0) {
          output.shapes.push({
            operations,
            variable: this.generateVariableName()
          })
        }
      }
      return this.formatter.format(output)
    } catch (error) {
      throw new KclWriteError(
        `Failed to write KCL: ${error instanceof Error ? error.message : 'Unknown error'}`
      )
    }
  }
}
