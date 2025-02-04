import { CommandType, Point, ViewBox } from './types'
import { ParsedCommand, ParsedPath } from './svg-parser'
export class KCLWriteError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'KCLWriteError'
  }
}

export interface KCLOptions {
  centerOnViewBox?: boolean
}

export class KCLWriter {
  private variableCounter: number = 1
  private readonly commands: string[] = []
  private readonly offsetCoords: Point
  private currentPoint: Point = { x: 0, y: 0 }

  constructor(viewBox: ViewBox, options: KCLOptions = {}) {
    // Calculate offset coordinates for centering if requested.

    const x = options.centerOnViewBox ? viewBox.xMin + viewBox.width / -2 : 0
    const y = options.centerOnViewBox ? viewBox.yMin + viewBox.height / 2 : 0
    this.offsetCoords = { x, y }
  }

  private generateVariableName(): string {
    return `sketch${String(this.variableCounter++).padStart(3, '0')}`
  }

  private addCommand(command: string): void {
    this.commands.push(command)
  }

  private transformPoint(point: Point, isRelative: boolean = false): Point {
    // Point should already have SVG transforms applied.
    return {
      x: point.x - this.offsetCoords.x,
      y: point.y - this.offsetCoords.y
    }
  }

  private invertY(point: Point): Point {
    // SVG is top-down, KCL is bottom-up.
    return {
      x: point.x,
      y: -point.y
    }
  }

  private writeStartSketch(point: Point): void {
    this.currentPoint = point
    const transformed = this.invertY(point)
    this.addCommand(
      `${this.generateVariableName()} = startSketchAt([${transformed.x}, ${transformed.y}])`
    )
  }

  private writeLine(point: Point): void {
    this.currentPoint = point
    const transformed = this.invertY(point)
    this.addCommand(`|> lineTo([${transformed.x}, ${transformed.y}], %)`)
  }

  private writeBezierCurve(command: ParsedCommand): void {
    const isRelative =
      command.type === CommandType.CubicBezierRelative ||
      command.type === CommandType.QuadraticBezierRelative

    if (command.values.length === 4) {
      // Quadratic bezier
      const [x1, y1, x, y] = command.values
      const c1x = isRelative ? x1 + this.currentPoint.x : x1
      const c1y = isRelative ? y1 + this.currentPoint.y : y1
      const endX = isRelative ? x + this.currentPoint.x : x
      const endY = isRelative ? y + this.currentPoint.y : y

      let control1 = {
        x: c1x - this.currentPoint.x + this.offsetCoords.x,
        y: c1y - this.currentPoint.y + this.offsetCoords.y
      }
      let endpoint = {
        x: endX - this.currentPoint.x + this.offsetCoords.x,
        y: endY - this.currentPoint.y + this.offsetCoords.y
      }

      control1 = this.invertY(control1)
      endpoint = this.invertY(endpoint)

      this.addCommand(`|> bezierCurve({
  control1 = [${control1.x}, ${control1.y}],
  control2 = [${control1.x}, ${control1.y}],
  to =  [${endpoint.x}, ${endpoint.y}]
}, %)`)

      this.currentPoint = { x: endX, y: endY }
    } else if (command.values.length === 6) {
      // Cubic bezier
      const [x1, y1, x2, y2, x, y] = command.values
      const c1x = isRelative ? x1 + this.currentPoint.x : x1
      const c1y = isRelative ? y1 + this.currentPoint.y : y1
      const c2x = isRelative ? x2 + this.currentPoint.x : x2
      const c2y = isRelative ? y2 + this.currentPoint.y : y2
      const endX = isRelative ? x + this.currentPoint.x : x
      const endY = isRelative ? y + this.currentPoint.y : y

      let control1 = {
        x: c1x - this.currentPoint.x + this.offsetCoords.x,
        y: c1y - this.currentPoint.y + this.offsetCoords.y
      }
      let control2 = {
        x: c2x - this.currentPoint.x + this.offsetCoords.x,
        y: c2y - this.currentPoint.y + this.offsetCoords.y
      }
      let endpoint = {
        x: endX - this.currentPoint.x + this.offsetCoords.x,
        y: endY - this.currentPoint.y + this.offsetCoords.y
      }

      control1 = this.invertY(control1)
      control2 = this.invertY(control2)
      endpoint = this.invertY(endpoint)

      this.addCommand(`|> bezierCurve({
  control1 = [${control1.x}, ${control1.y}],
  control2 = [${control2.x}, ${control2.y}],
  to = [${endpoint.x}, ${endpoint.y}]
}, %)`)

      this.currentPoint = { x: endX, y: endY }
    }
  }

  public processPath(path: ParsedPath): void {
    let isFirstCommand = true

    for (const command of path.commands) {
      switch (command.type) {
        case CommandType.MoveAbsolute:
        case CommandType.MoveRelative: {
          if (isFirstCommand) {
            this.writeStartSketch(command.position)
            isFirstCommand = false
          } else {
            this.addCommand(`|> close(%)\n`)
            this.writeStartSketch(command.position)
          }
          break
        }
        case CommandType.LineAbsolute:
        case CommandType.LineRelative:
        case CommandType.HorizontalLineAbsolute:
        case CommandType.HorizontalLineRelative:
        case CommandType.VerticalLineAbsolute:
        case CommandType.VerticalLineRelative: {
          this.writeLine(command.position)
          break
        }
        case CommandType.QuadraticBezierAbsolute:
        case CommandType.QuadraticBezierRelative:
        case CommandType.CubicBezierAbsolute:
        case CommandType.CubicBezierRelative: {
          this.writeBezierCurve(command)
          break
        }
        case CommandType.StopAbsolute:
        case CommandType.StopRelative: {
          this.addCommand(`|> close(%)\n`)
          break
        }
      }
    }

    // Ensure path is closed
    if (
      !path.commands.some(
        (cmd) => cmd.type === CommandType.StopAbsolute || cmd.type === CommandType.StopRelative
      )
    ) {
      this.addCommand(`|> close(%)\n`)
    }
  }

  public generateOutput(): string {
    return this.commands.join('\n')
  }
}
