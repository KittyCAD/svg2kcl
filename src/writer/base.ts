import { promises as fs } from 'node:fs'
import { KclOperation, KclOptions, KclOutput } from '../types/kcl'
import { Formatter } from './formatter'
export class KclWriteError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'KclWriteError'
  }
}

export class KclWriter {
  private variableCounter = 1
  private formatter: Formatter

  constructor(options: KclOptions = {}) {
    this.formatter = new Formatter(options)
  }

  private generateVariableName(): string {
    return `sketch${String(this.variableCounter++).padStart(3, '0')}`
  }

  public format(kclOperationSets: KclOperation[][]): string {
    try {
      const output: KclOutput = { shapes: [] }

      for (const operations of kclOperationSets) {
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

  public async formatAndWrite(
    kclOperationSets: KclOperation[][],
    outputPath: string
  ): Promise<string> {
    const formattedKcl = this.format(kclOperationSets)
    const kcl = formattedKcl && !formattedKcl.endsWith('\n') ? `${formattedKcl}\n` : formattedKcl
    await fs.writeFile(outputPath, kcl, 'utf8')
    return kcl
  }
}
