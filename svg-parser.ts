import { CommandType, SVGCommandMap, Point, PathState } from './types'

export class SVGParseError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SVGParseError'
  }
}

export interface ParsedCommand {
  type: CommandType
  values: number[]
  position: Point
}

export interface ParsedPath {
  commands: ParsedCommand[]
  startPosition: Point
}

export class SVGPathParser {
  private state: PathState
  private path: ParsedPath

  constructor() {
    this.state = {
      command: CommandType.NotSet,
      values: [],
      valueBuffer: '',
      currentPoint: { x: 0, y: 0 },
      isPathOpen: false,
      isValuePushed: true
    }

    this.path = {
      commands: [],
      startPosition: { x: 0, y: 0 }
    }
  }

  private pushValue(): void {
    if (this.state.valueBuffer.length === 0) {
      return
    }

    const value = parseFloat(this.state.valueBuffer)
    if (!isNaN(value)) {
      this.state.values.push(value)
    }
    this.state.valueBuffer = ''
  }

  private processValues(chunk: number[]): void {
    switch (this.state.command) {
      case CommandType.MoveAbsolute: {
        this.state.currentPoint = { x: chunk[0], y: chunk[1] }
        if (!this.path.commands.length) {
          this.path.startPosition = { ...this.state.currentPoint }
        }
        break
      }
      case CommandType.MoveRelative: {
        this.state.currentPoint.x += chunk[0]
        this.state.currentPoint.y += chunk[1]
        if (!this.path.commands.length) {
          this.path.startPosition = { ...this.state.currentPoint }
        }
        break
      }
      case CommandType.LineAbsolute: {
        this.state.currentPoint = { x: chunk[0], y: chunk[1] }
        break
      }
      case CommandType.LineRelative: {
        this.state.currentPoint.x += chunk[0]
        this.state.currentPoint.y += chunk[1]
        break
      }
      case CommandType.HorizontalLineAbsolute: {
        this.state.currentPoint.x = chunk[0]
        break
      }
      case CommandType.HorizontalLineRelative: {
        this.state.currentPoint.x += chunk[0]
        break
      }
      case CommandType.VerticalLineAbsolute: {
        this.state.currentPoint.y = chunk[0]
        break
      }
      case CommandType.VerticalLineRelative: {
        this.state.currentPoint.y += chunk[0]
        break
      }
      case CommandType.CubicBezierAbsolute: {
        this.state.currentPoint = { x: chunk[4], y: chunk[5] }
        break
      }
      case CommandType.CubicBezierRelative: {
        this.state.currentPoint.x += chunk[4]
        this.state.currentPoint.y += chunk[5]
        break
      }
      case CommandType.QuadraticBezierAbsolute: {
        this.state.currentPoint = { x: chunk[2], y: chunk[3] }
        break
      }
      case CommandType.QuadraticBezierRelative: {
        this.state.currentPoint.x += chunk[2]
        this.state.currentPoint.y += chunk[3]
        break
      }
    }
  }

  private handleCommand(): void {
    if (this.state.command === CommandType.NotSet || this.state.values.length === 0) {
      return
    }

    let chunkSize = 2 // Default for most commands
    switch (this.state.command) {
      case CommandType.CubicBezierAbsolute:
      case CommandType.CubicBezierRelative:
        chunkSize = 6
        break
      case CommandType.QuadraticBezierAbsolute:
      case CommandType.QuadraticBezierRelative:
        chunkSize = 4
        break
      case CommandType.HorizontalLineAbsolute:
      case CommandType.HorizontalLineRelative:
      case CommandType.VerticalLineAbsolute:
      case CommandType.VerticalLineRelative:
        chunkSize = 1
        break
    }

    // Process values in chunks
    for (let i = 0; i < this.state.values.length; i += chunkSize) {
      const chunk = this.state.values.slice(i, i + chunkSize)
      if (chunk.length === chunkSize) {
        // Only process complete chunks
        this.processValues(chunk)

        this.path.commands.push({
          type: this.state.command,
          values: [...chunk],
          position: { ...this.state.currentPoint }
        })
      }
    }
  }

  public parsePath(pathData: string): ParsedPath {
    this.path = {
      commands: [],
      startPosition: { x: 0, y: 0 }
    }

    this.state = {
      command: CommandType.NotSet,
      values: [],
      valueBuffer: '',
      currentPoint: { x: 0, y: 0 },
      isPathOpen: false,
      isValuePushed: true
    }

    for (let i = 0; i < pathData.length; i++) {
      const char = pathData[i]

      if (char in SVGCommandMap) {
        this.pushValue()
        this.handleCommand()
        this.state.command = SVGCommandMap[char]
        this.state.values = []
        this.state.isValuePushed = false
      } else if (char === '-') {
        if (
          this.state.valueBuffer.length > 0 &&
          this.state.valueBuffer[this.state.valueBuffer.length - 1] !== 'e' &&
          this.state.valueBuffer[this.state.valueBuffer.length - 1] !== 'E'
        ) {
          this.pushValue()
        }
        this.state.valueBuffer = char
      } else if (char === ',' || char === ' ' || char === '\t' || char === '\n' || char === '\r') {
        this.pushValue()
      } else if (/[\d.eE]/.test(char)) {
        this.state.valueBuffer += char
      }
    }

    // Handle any remaining values and commands
    this.pushValue()
    this.handleCommand()

    return this.path
  }
}

export class SVGParser {
  private pathParser: SVGPathParser

  constructor() {
    this.pathParser = new SVGPathParser()
  }

  public parse(svgElement: { paths: Array<{ d: string }> }): ParsedPath[] {
    try {
      return svgElement.paths.map((path) => this.pathParser.parsePath(path.d))
    } catch (error) {
      throw new SVGParseError(
        `Failed to parse SVG paths: ${error instanceof Error ? error.message : 'Unknown error'}`
      )
    }
  }
}
