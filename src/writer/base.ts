import { KclOptions, KclOutput, KclShape } from '../types/kcl'
import { SVG } from '../types/svg'
import { Converter } from './converter'
import { Formatter } from './formatter'

export class KclWriteError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'KclWriteError'
  }
}

export class KclWriter {
  private variableCounter: number = 1
  private converter: Converter
  private formatter: Formatter

  constructor(private svg: SVG, private options: KclOptions = {}) {
    this.converter = new Converter(options, svg.viewBox)
    this.formatter = new Formatter()
  }

  private generateVariableName(): string {
    return `sketch${String(this.variableCounter++).padStart(3, '0')}`
  }

  public write(): string {
    try {
      const output: KclOutput = {
        shapes: []
      }

      // Convert each element to Kcl operation.
      for (const element of this.svg.elements) {
        const operations = this.converter.convertElement(this.svg.elements, element)
        if (operations.length > 0) {
          const shape: KclShape = {
            operations,
            variable: this.generateVariableName()
          }
          output.shapes.push(shape)
        }
      }

      // Format the output into Kcl code
      return this.formatter.format(output)
    } catch (error) {
      throw new KclWriteError(
        `Failed to write Kcl: ${error instanceof Error ? error.message : 'Unknown error'}`
      )
    }
  }
}
