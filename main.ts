import { readFile } from 'fs/promises'
import { JSDOM } from 'jsdom'

// Add DOM types
type DOMElement = JSDOM['window']['Element']

// Types
type Point = { x: number; y: number }

interface Transform {
  x: number
  y: number
}

interface ViewBox {
  width: number
  height: number
}

// Commands enum
const Command = {
  NotSet: 'NotSet',
  MoveAbsolute: 'MoveAbsolute',
  MoveRelative: 'MoveRelative',
  LineAbsolute: 'LineAbsolute',
  LineRelative: 'LineRelative',
  HorizontalLineAbsolute: 'HorizontalLineAbsolute',
  HorizontalLineRelative: 'HorizontalLineRelative',
  VerticalLineAbsolute: 'VerticalLineAbsolute',
  VerticalLineRelative: 'VerticalLineRelative',
  QuadraticBezierAbsolute: 'QuadraticBezierAbsolute',
  QuadraticBezierRelative: 'QuadraticBezierRelative',
  QuadraticBezierSmoothAbsolute: 'QuadraticBezierSmoothAbsolute',
  QuadraticBezierSmoothRelative: 'QuadraticBezierSmoothRelative',
  CubicBezierAbsolute: 'CubicBezierAbsolute',
  CubicBezierRelative: 'CubicBezierRelative',
  CubicBezierSmoothAbsolute: 'CubicBezierSmoothAbsolute',
  CubicBezierSmoothRelative: 'CubicBezierSmoothRelative',
  EllipticalArcAbsolute: 'EllipticalArcAbsolute',
  EllipticalArcRelative: 'EllipticalArcRelative',
  StopAbsolute: 'StopAbsolute',
  StopRelative: 'StopRelative'
} as const

type CommandType = keyof typeof Command

// Parsed command class
class PathCommand {
  constructor(public type: CommandType, public values: number[], public position: Point) {}
}

// Parser state interface
interface ParserState {
  command: CommandType
  values: number[]
  valueBuffer: string
  currentPoint: Point
  isValuePushed: boolean
}

// Main parser class
class SVGParser {
  private state: ParserState = {
    command: 'NotSet',
    values: [],
    valueBuffer: '',
    currentPoint: { x: 0, y: 0 },
    isValuePushed: true
  }

  private pushValue() {
    if (this.state.valueBuffer.length === 0) return

    const value = parseFloat(this.state.valueBuffer)
    this.state.values.push(value)
    this.state.valueBuffer = ''
  }

  private pushCommand(command: CommandType) {
    if (this.state.valueBuffer !== '') {
      this.pushValue()
      this.state.isValuePushed = true
    }

    this.state.command = command
    this.state.values = []
    this.state.valueBuffer = ''
    this.state.isValuePushed = false
  }

  parseCommands(pathData: string): PathCommand[] {
    const commands: PathCommand[] = []

    for (const char of pathData) {
      switch (char) {
        case 'M':
          this.pushCommand('MoveAbsolute')
          break
        case 'm':
          this.pushCommand('MoveRelative')
          break
        case 'L':
          this.pushCommand('LineAbsolute')
          break
        case 'l':
          this.pushCommand('LineRelative')
          break
        case 'H':
          this.pushCommand('HorizontalLineAbsolute')
          break
        case 'h':
          this.pushCommand('HorizontalLineRelative')
          break
        case 'V':
          this.pushCommand('VerticalLineAbsolute')
          break
        case 'v':
          this.pushCommand('VerticalLineRelative')
          break
        case 'C':
          this.pushCommand('CubicBezierAbsolute')
          break
        case 'c':
          this.pushCommand('CubicBezierRelative')
          break
        case 'S':
          this.pushCommand('CubicBezierSmoothAbsolute')
          break
        case 's':
          this.pushCommand('CubicBezierSmoothRelative')
          break
        case 'Q':
          this.pushCommand('QuadraticBezierAbsolute')
          break
        case 'q':
          this.pushCommand('QuadraticBezierRelative')
          break
        case 'T':
          this.pushCommand('QuadraticBezierSmoothAbsolute')
          break
        case 't':
          this.pushCommand('QuadraticBezierSmoothRelative')
          break
        case 'A':
          this.pushCommand('EllipticalArcAbsolute')
          break
        case 'a':
          this.pushCommand('EllipticalArcRelative')
          break
        case 'Z':
          this.pushCommand('StopAbsolute')
          break
        case 'z':
          this.pushCommand('StopRelative')
          break
        case ',':
          this.pushValue()
          break
        case '-': {
          this.pushValue()
          this.state.valueBuffer += char
          break
        }
        case ' ': {
          this.pushValue()
          this.state.isValuePushed = true
          break
        }
        case '0':
        case '1':
        case '2':
        case '3':
        case '4':
        case '5':
        case '6':
        case '7':
        case '8':
        case '9':
        case '.': {
          this.state.valueBuffer += char
          break
        }
      }

      if (this.shouldCreateCommand()) {
        commands.push(new PathCommand(this.state.command, [...this.state.values], { ...this.state.currentPoint }))
      }
    }

    // Handle any remaining values
    if (this.state.valueBuffer.length > 0) {
      this.pushValue()
      commands.push(new PathCommand(this.state.command, [...this.state.values], { ...this.state.currentPoint }))
    }

    return commands
  }

  private shouldCreateCommand(): boolean {
    return this.state.command === 'StopAbsolute' || this.state.command === 'StopRelative'
  }
}

// KCL code generator
class KCLGenerator {
  private variableCounter = 0

  constructor(private viewBox: ViewBox, private transform: Transform) {}

  private generateVariableName(): string {
    return `a${this.variableCounter++}`
  }

  private transformPoint(point: Point): Point {
    return {
      x: point.x + this.transform.x + this.viewBox.width / -2,
      y: -point.y + this.transform.y + this.viewBox.height / 2
    }
  }

  generateCode(commands: PathCommand[]): string {
    let output = ''
    let isPathOpen = false

    for (const cmd of commands) {
      switch (cmd.type) {
        case 'MoveAbsolute':
        case 'MoveRelative': {
          if (isPathOpen) {
            output += '|> close(%)\n\n'
          }
          const point = this.transformPoint(cmd.position)
          const varName = this.generateVariableName()
          output += `let ${varName} = startSketchAt([${point.x}, ${point.y}])\n`
          isPathOpen = true
          break
        }
        case 'LineAbsolute':
        case 'LineRelative': {
          const point = this.transformPoint(cmd.position)
          output += `|> lineTo([${point.x}, ${point.y}], %)\n`
          break
        }
        case 'CubicBezierAbsolute':
        case 'CubicBezierRelative': {
          const chunks = cmd.values.length === 6 ? [cmd.values] : chunk(cmd.values, 6)

          for (const [c1x, c1y, c2x, c2y, x, y] of chunks) {
            const control1 = this.transformPoint({ x: c1x, y: c1y })
            const control2 = this.transformPoint({ x: c2x, y: c2y })
            const to = this.transformPoint({ x, y })

            output += `|> bezierCurve({
  control1: [${control1.x}, ${control1.y}],
  control2: [${control2.x}, ${control2.y}],
  to: [${to.x}, ${to.y}]
}, %)\n`
          }
          break
        }
        case 'StopAbsolute':
        case 'StopRelative': {
          output += '|> close(%)\n'
          isPathOpen = false
          break
        }
      }
    }

    if (isPathOpen) {
      output += '|> close(%)\n'
    }

    return output
  }
}

// Helper function to chunk arrays
function chunk<T>(array: T[], size: number): T[][] {
  const chunks: T[][] = []
  for (let i = 0; i < array.length; i += size) {
    chunks.push(array.slice(i, i + size))
  }
  return chunks
}

// Main converter class
export class SVGToKCL {
  private parser: SVGParser
  private generator: KCLGenerator

  constructor(viewBox: ViewBox, transform: Transform = { x: 0, y: 0 }) {
    this.parser = new SVGParser()
    this.generator = new KCLGenerator(viewBox, transform)
  }

  convert(svgPathData: string): string {
    const commands = this.parser.parseCommands(svgPathData)
    return this.generator.generateCode(commands)
  }
}

// SVG File Parser
class SVGFileParser {
  static async parseFile(filePath: string): Promise<{
    viewBox: ViewBox
    paths: string[]
  }> {
    const svgContent = await readFile(filePath, { encoding: 'utf8' })
    const dom = new JSDOM(svgContent)
    const doc = dom.window.document
    const svgElement = doc.querySelector('svg')

    if (!svgElement) {
      throw new Error('No SVG element found')
    }

    // Get viewBox or width/height
    const viewBox = this.getViewBox(svgElement)

    // Get all paths
    const paths = Array.from(doc.querySelectorAll('path'))
      .map((path) => path.getAttribute('d'))
      .filter((d): d is string => d !== null)

    return { viewBox, paths }
  }

  private static getViewBox(svg: Element): ViewBox {
    const viewBoxAttr = svg.getAttribute('viewBox')
    const viewBox = viewBoxAttr?.split(' ').map(Number)

    if (viewBox && viewBox.length === 4) {
      return {
        width: viewBox[2],
        height: viewBox[3]
      }
    }

    // Fallback to width/height attributes
    const width = svg.getAttribute('width')
    const height = svg.getAttribute('height')

    return {
      width: width ? parseFloat(width) : 100,
      height: height ? parseFloat(height) : 100
    }
  }
}

async function main() {
  try {
    const { viewBox, paths } = await SVGFileParser.parseFile('project_payload.svg')
    const converter = new SVGToKCL(viewBox)

    let fullOutput = ''
    for (const pathData of paths) {
      fullOutput += converter.convert(pathData) + '\n'
    }

    console.log(fullOutput)
  } catch (error) {
    console.error('Error processing SVG:', error)
  }
}

main()
