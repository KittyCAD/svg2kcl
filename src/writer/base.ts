import { SVG } from '../types/svg'
import { KCLOptions, KCLOutput, KCLShape } from '../types/kcl'
import { Converter } from './converter'
import { Formatter } from './formatter'

export class KCLWriteError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'KCLWriteError'
  }
}

export class KCLWriter {
  private variableCounter: number = 1
  private converter: Converter
  private formatter: Formatter

  constructor(private svg: SVG, private options: KCLOptions = {}) {
    this.converter = new Converter(options, svg.viewBox)
    this.formatter = new Formatter()
  }

  private generateVariableName(): string {
    return `sketch${String(this.variableCounter++).padStart(3, '0')}`
  }

  public write(): string {
    try {
      const output: KCLOutput = {
        shapes: []
      }

      // Convert each element to KCL operation.
      for (const element of this.svg.elements) {
        const operations = this.converter.convertElement(this.svg.elements, element)
        if (operations.length > 0) {
          const shape: KCLShape = {
            operations,
            variable: this.generateVariableName()
          }
          output.shapes.push(shape)
        }
      }

      // Format the output into KCL code
      return this.formatter.format(output)
    } catch (error) {
      throw new KCLWriteError(
        `Failed to write KCL: ${error instanceof Error ? error.message : 'Unknown error'}`
      )
    }
  }
}
