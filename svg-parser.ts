import { CommandType, SVGCommandMap, Point, PathState } from './types'
import { Matrix } from './transform'

export class SVGParseError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SVGParseError'
  }
}

export interface ParsedCommand {
  type: CommandType
  parameters: number[]
  position: Point
}

export interface ParsedPath {
  commands: ParsedCommand[]
  startPosition: Point
}

export class SVGPathParser {
  private state: PathState
  private path: ParsedPath
  private transform: Matrix | null

  constructor() {
    this.transform = null

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

  private applyTransform(point: Point): Point {
    if (!this.transform) return point

    return {
      x: this.transform.a * point.x + this.transform.c * point.y + this.transform.e,
      y: this.transform.b * point.x + this.transform.d * point.y + this.transform.f
    }
  }

  private isWhitespace(char: string): boolean {
    return [',', ' ', '\t', '\n', '\r'].includes(char)
  }

  private isNumericChar(char: string): boolean {
    return /[\d.eE]/.test(char)
  }

  private isValidNegative(): boolean {
    if (this.state.valueBuffer.length === 0) return true
    const lastChar = this.state.valueBuffer[this.state.valueBuffer.length - 1]
    return lastChar !== 'e' && lastChar !== 'E'
  }

  private handleCommandChar(char: string): void {
    this.pushValue()
    this.handleCommand()
    this.state.command = SVGCommandMap[char]
    this.state.values = []
    this.state.isValuePushed = false
  }

  private handleNegative(): void {
    if (this.isValidNegative()) {
      this.pushValue()
    }
    this.state.valueBuffer = '-'
  }

  private handleChar(char: string): void {
    if (char in SVGCommandMap) {
      this.handleCommandChar(char)
    } else if (char === '-') {
      this.handleNegative()
    } else if (this.isWhitespace(char)) {
      this.pushValue()
    } else if (this.isNumericChar(char)) {
      this.state.valueBuffer += char
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

  private transformChunk(chunk: number[], chunkSize: number): number[] {
    // Don't transform if no transform matrix
    if (!this.transform) return chunk

    // Transform pairs of coordinates
    const transformed: number[] = []
    for (let i = 0; i < chunk.length; i += 2) {
      if (i + 1 < chunk.length) {
        // If we have a pair of coordinates, transform them
        const point = this.applyTransform({ x: chunk[i], y: chunk[i + 1] })
        transformed.push(point.x, point.y)
      } else {
        // For single values (like in H/V commands), pass through
        transformed.push(chunk[i])
      }
    }
    return transformed
  }

  private processValues(parameters: number[]): void {
    let transformedChunk = [...parameters]

    // Transform absolute coordinates.
    switch (this.state.command) {
      case CommandType.MoveAbsolute:
      case CommandType.LineAbsolute:
      case CommandType.CubicBezierAbsolute:
      case CommandType.QuadraticBezierAbsolute:
      case CommandType.EllipticalArcAbsolute:
        transformedChunk = this.transformChunk(parameters, 2)
        break
      case CommandType.HorizontalLineAbsolute:
        if (this.transform) {
          // For H, transform considering current X.
          transformedChunk = [
            this.applyTransform({ x: parameters[0], y: this.state.currentPoint.y }).x
          ]
        }
        break
      case CommandType.VerticalLineAbsolute:
        if (this.transform) {
          // For V, transform considering current Y.
          transformedChunk = [
            this.applyTransform({ x: this.state.currentPoint.x, y: parameters[0] }).y
          ]
        }
        break
    }

    // Update currentPoint for absolute commands.
    switch (this.state.command) {
      case CommandType.MoveAbsolute:
      case CommandType.LineAbsolute:
        this.state.currentPoint = { x: transformedChunk[0], y: transformedChunk[1] }
        if (this.state.command === CommandType.MoveAbsolute && !this.path.commands.length) {
          this.path.startPosition = { ...this.state.currentPoint }
        }
        break
      case CommandType.HorizontalLineAbsolute:
        this.state.currentPoint.x = transformedChunk[0]
        break
      case CommandType.VerticalLineAbsolute:
        this.state.currentPoint.y = transformedChunk[0]
        break
      case CommandType.CubicBezierAbsolute:
        this.state.currentPoint = { x: transformedChunk[4], y: transformedChunk[5] }
        break
      case CommandType.QuadraticBezierAbsolute:
        this.state.currentPoint = { x: transformedChunk[2], y: transformedChunk[3] }
        break
      case CommandType.CubicBezierSmoothAbsolute:
        this.state.currentPoint = { x: transformedChunk[2], y: transformedChunk[3] }
        break
      case CommandType.QuadraticBezierSmoothAbsolute:
        this.state.currentPoint = { x: transformedChunk[0], y: transformedChunk[1] }
        break
      case CommandType.EllipticalArcAbsolute:
        this.state.currentPoint = { x: transformedChunk[5], y: transformedChunk[6] }
        break
    }

    // Update currentPoint for relative commands.
    switch (this.state.command) {
      case CommandType.MoveRelative:
      case CommandType.LineRelative:
        this.state.currentPoint.x += parameters[0]
        this.state.currentPoint.y += parameters[1]
        if (this.state.command === CommandType.MoveRelative && !this.path.commands.length) {
          this.path.startPosition = { ...this.state.currentPoint }
        }
        break
      case CommandType.HorizontalLineRelative:
        this.state.currentPoint.x += parameters[0]
        break
      case CommandType.VerticalLineRelative:
        this.state.currentPoint.y += parameters[0]
        break
      case CommandType.CubicBezierRelative:
        this.state.currentPoint.x += parameters[4]
        this.state.currentPoint.y += parameters[5]
        break
      case CommandType.QuadraticBezierRelative:
        this.state.currentPoint.x += parameters[2]
        this.state.currentPoint.y += parameters[3]
        break
      case CommandType.CubicBezierSmoothRelative:
        this.state.currentPoint.x += parameters[2]
        this.state.currentPoint.y += parameters[3]
        break
      case CommandType.QuadraticBezierSmoothRelative:
        this.state.currentPoint.x += parameters[0]
        this.state.currentPoint.y += parameters[1]
        break
      case CommandType.EllipticalArcRelative:
        this.state.currentPoint.x += parameters[5]
        this.state.currentPoint.y += parameters[6]
        break
      case CommandType.StopAbsolute:
      case CommandType.StopRelative:
        this.state.currentPoint = { ...this.path.startPosition }
        break
    }

    // Push the command with transformed values for absolute commands.
    this.path.commands.push({
      type: this.state.command,
      parameters: this.state.command.endsWith('a') ? transformedChunk : parameters,
      position: { ...this.state.currentPoint }
    })
  }

  private handleCommand(): void {
    if (this.state.command === CommandType.NotSet || this.state.values.length === 0) {
      return
    }

    const chunkSizeMap = {
      [CommandType.MoveAbsolute]: 2,
      [CommandType.MoveRelative]: 2,
      [CommandType.LineAbsolute]: 2,
      [CommandType.LineRelative]: 2,
      [CommandType.HorizontalLineAbsolute]: 1,
      [CommandType.HorizontalLineRelative]: 1,
      [CommandType.VerticalLineAbsolute]: 1,
      [CommandType.VerticalLineRelative]: 1,
      [CommandType.CubicBezierAbsolute]: 6,
      [CommandType.CubicBezierRelative]: 6,
      [CommandType.CubicBezierSmoothAbsolute]: 4,
      [CommandType.CubicBezierSmoothRelative]: 4,
      [CommandType.QuadraticBezierAbsolute]: 4,
      [CommandType.QuadraticBezierRelative]: 4,
      [CommandType.QuadraticBezierSmoothAbsolute]: 2,
      [CommandType.QuadraticBezierSmoothRelative]: 2,
      [CommandType.EllipticalArcAbsolute]: 7,
      [CommandType.EllipticalArcRelative]: 7,
      [CommandType.StopAbsolute]: 0,
      [CommandType.StopRelative]: 0
    }

    let chunkSize = chunkSizeMap[this.state.command] || 2

    // Process values in chunks
    for (let i = 0; i < this.state.values.length; i += chunkSize) {
      const chunk = this.state.values.slice(i, i + chunkSize)
      if (chunk.length === chunkSize) {
        this.processValues(chunk)
      }
    }
  }

  public parsePath(pathData: string, transform: Matrix | null = null): ParsedPath {
    this.transform = transform

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

    for (const char of pathData) {
      this.handleChar(char)
    }

    this.pushValue()
    this.handleCommand()

    return this.path
  }
}

export interface SVGPathInfo {
  d: string
  transform?: Matrix | null
}

export class SVGParser {
  private pathParser: SVGPathParser

  constructor() {
    this.pathParser = new SVGPathParser()
  }

  public parse(svgElement: { paths: SVGPathInfo[] }): ParsedPath[] {
    try {
      const output = svgElement.paths.map((path) =>
        this.pathParser.parsePath(path.d, path.transform)
      )
      return output
    } catch (error) {
      throw new SVGParseError(
        `Failed to parse SVG paths: ${error instanceof Error ? error.message : 'Unknown error'}`
      )
    }
  }
}
