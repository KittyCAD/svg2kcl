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

interface PathInfo {
  commands: ParsedCommand[]
  isClockwise: boolean
}

export class KCLWriter {
  private variableCounter: number = 1
  private readonly commands: string[] = []
  private readonly offsetCoords: Point

  private currentPoint: Point = { x: 0, y: 0 }

  // Track previous control point for smooth curves:
  // https://www.w3.org/TR/SVG2/paths.html#PathDataCubicBezierCommands
  private previousControlPoint: Point = { x: 0, y: 0 }

  constructor(viewBox: ViewBox, options: KCLOptions = {}) {
    // Calculate offset coordinates for centering if requested.
    const x = options.centerOnViewBox ? viewBox.xMin + viewBox.width / 2 : 0
    const y = options.centerOnViewBox ? viewBox.yMin + viewBox.height / 2 : 0
    this.offsetCoords = { x, y }
  }

  private generateVariableName(): string {
    return `sketch${String(this.variableCounter++).padStart(3, '0')}`
  }

  private addCommand(command: string): void {
    this.commands.push(command)
  }

  private transformPoint(point: Point): Point {
    // Point should already have SVG transforms applied, so just center.
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

  private isClockwise(commands: ParsedCommand[]): boolean {
    let sum = 0
    for (let i = 0; i < commands.length - 1; i++) {
      const curr = commands[i].position
      const next = commands[i + 1].position
      sum += (next.x - curr.x) * (next.y + curr.y)
    }
    return sum > 0
  }

  private separateSubpaths(path: ParsedPath): PathInfo[] {
    const subpaths: PathInfo[] = []
    let currentCommands: ParsedCommand[] = []

    for (const command of path.commands) {
      if (
        (command.type === CommandType.MoveAbsolute || command.type === CommandType.MoveRelative) &&
        currentCommands.length > 0
      ) {
        subpaths.push({
          commands: currentCommands,
          isClockwise: this.isClockwise(currentCommands)
        })
        currentCommands = []
      }
      currentCommands.push(command)
    }

    if (currentCommands.length > 0) {
      subpaths.push({
        commands: currentCommands,
        isClockwise: this.isClockwise(currentCommands)
      })
    }

    return subpaths
  }

  private calculateReflectedControlPoint(): Point {
    if (!this.previousControlPoint) {
      // If no previous control point, use current point
      return this.currentPoint
    }

    // Reflect the previous control point about current point
    return {
      x: 2 * this.currentPoint.x - this.previousControlPoint.x,
      y: 2 * this.currentPoint.y - this.previousControlPoint.y
    }
  }

  private writeStartSketch(point: Point, isHole: boolean = false): void {
    this.currentPoint = point
    let outPoint = this.transformPoint(point)
    outPoint = this.invertY(outPoint)

    if (isHole) {
      // For holes, just output the startSketchAt without assignment
      this.addCommand(`startSketchAt([${outPoint.x}, ${outPoint.y}])`)
    } else {
      this.addCommand(
        `${this.generateVariableName()} = startSketchAt([${outPoint.x}, ${outPoint.y}])`
      )
    }
  }

  private writeLine(point: Point): void {
    this.currentPoint = point

    // Transform, invert, and write the command.
    let outPoint = this.transformPoint(point)
    outPoint = this.invertY(outPoint)
    this.addCommand(`|> lineTo([${outPoint.x}, ${outPoint.y}], %)`)
  }

  private writeQuadraticBezierCurve(command: ParsedCommand): void {
    const isRelative = command.type === CommandType.QuadraticBezierRelative

    // Quadratic bezier.
    const [x1, y1, x, y] = command.parameters
    const c1x = isRelative ? x1 + this.currentPoint.x : x1
    const c1y = isRelative ? y1 + this.currentPoint.y : y1
    const endX = isRelative ? x + this.currentPoint.x : x
    const endY = isRelative ? y + this.currentPoint.y : y

    // Save last control point for smooth curves.
    this.previousControlPoint = { x: c1x, y: c1y }

    let control1 = {
      x: c1x - this.currentPoint.x + this.offsetCoords.x,
      y: c1y - this.currentPoint.y + this.offsetCoords.y
    }
    let endpoint = {
      x: endX - this.currentPoint.x + this.offsetCoords.x,
      y: endY - this.currentPoint.y + this.offsetCoords.y
    }

    this.currentPoint = { x: endX, y: endY }

    // Transform, invert, and write the command.
    control1 = this.transformPoint(control1)
    endpoint = this.transformPoint(endpoint)

    control1 = this.invertY(control1)
    endpoint = this.invertY(endpoint)

    this.addCommand(`|> bezierCurve({
  control1 = [${control1.x}, ${control1.y}],
  control2 = [${control1.x}, ${control1.y}],
  to = [${endpoint.x}, ${endpoint.y}]
}, %)`)
  }

  private writeSmoothQuadraticBezierCurve(command: ParsedCommand): void {
    const isRelative = command.type === CommandType.QuadraticBezierSmoothRelative

    // Get reflected control point.
    const control = this.calculateReflectedControlPoint()

    // Get endpoint from command.
    const [x, y] = command.parameters
    const endX = isRelative ? x + this.currentPoint.x : x
    const endY = isRelative ? y + this.currentPoint.y : y

    let endpoint = {
      x: endX - this.currentPoint.x + this.offsetCoords.x,
      y: endY - this.currentPoint.y + this.offsetCoords.y
    }

    // Save control point for next smooth curve.
    this.previousControlPoint = control
    this.currentPoint = { x: endX, y: endY }

    // Transform and invert points.
    endpoint = this.transformPoint(endpoint)
    const transformedControl = this.transformPoint(control)
    const invertedControl = this.invertY(transformedControl)
    const invertedEndpoint = this.invertY(endpoint)

    this.addCommand(`|> bezierCurve({
    control1 = [${invertedControl.x}, ${invertedControl.y}], 
    control2 = [${invertedControl.x}, ${invertedControl.y}],
    to = [${invertedEndpoint.x}, ${invertedEndpoint.y}]
  }, %)`)
  }

  private writeCubicBezierCurve(command: ParsedCommand): void {
    const isRelative = command.type === CommandType.CubicBezierRelative

    // Cubic bezier
    const [x1, y1, x2, y2, x, y] = command.parameters
    const c1x = isRelative ? x1 + this.currentPoint.x : x1
    const c1y = isRelative ? y1 + this.currentPoint.y : y1
    const c2x = isRelative ? x2 + this.currentPoint.x : x2
    const c2y = isRelative ? y2 + this.currentPoint.y : y2
    const endX = isRelative ? x + this.currentPoint.x : x
    const endY = isRelative ? y + this.currentPoint.y : y

    // Save last control point for smooth curves.
    this.previousControlPoint = { x: c2x, y: c2y }

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

    this.currentPoint = { x: endX, y: endY }

    // Transform, invert, and write the command.
    control1 = this.transformPoint(control1)
    control2 = this.transformPoint(control2)
    endpoint = this.transformPoint(endpoint)

    control1 = this.invertY(control1)
    control2 = this.invertY(control2)
    endpoint = this.invertY(endpoint)

    this.addCommand(`|> bezierCurve({
  control1 = [${control1.x}, ${control1.y}],
  control2 = [${control2.x}, ${control2.y}],
  to = [${endpoint.x}, ${endpoint.y}]
}, %)`)
  }

  private writeSmoothCubicBezierCurve(command: ParsedCommand): void {
    const isRelative = command.type === CommandType.CubicBezierSmoothRelative

    // Get reflected control point.
    const control1 = this.calculateReflectedControlPoint()

    // Second control point and endpoint from command.
    const [x2, y2, x, y] = command.parameters
    const c2x = isRelative ? x2 + this.currentPoint.x : x2
    const c2y = isRelative ? y2 + this.currentPoint.y : y2
    const endX = isRelative ? x + this.currentPoint.x : x
    const endY = isRelative ? y + this.currentPoint.y : y

    let control2 = {
      x: c2x - this.currentPoint.x + this.offsetCoords.x,
      y: c2y - this.currentPoint.y + this.offsetCoords.y
    }
    let endpoint = {
      x: endX - this.currentPoint.x + this.offsetCoords.x,
      y: endY - this.currentPoint.y + this.offsetCoords.y
    }

    // Save second control point for next smooth curve.
    this.previousControlPoint = { x: c2x, y: c2y }
    this.currentPoint = { x: endX, y: endY }

    // Transform and invert points.
    control2 = this.transformPoint(control2)
    endpoint = this.transformPoint(endpoint)

    const transformedControl1 = this.transformPoint(control1)
    const invertedControl1 = this.invertY(transformedControl1)
    const invertedControl2 = this.invertY(control2)
    const invertedEndpoint = this.invertY(endpoint)

    this.addCommand(`|> bezierCurve({
    control1 = [${invertedControl1.x}, ${invertedControl1.y}],
    control2 = [${invertedControl2.x}, ${invertedControl2.y}],
    to = [${invertedEndpoint.x}, ${invertedEndpoint.y}]
  }, %)`)
  }

  private writeSubpath(commands: ParsedCommand[], isHole: boolean = false): void {
    let isFirstCommand = true

    if (isHole) {
      this.addCommand('|> hole(')
    }

    for (const command of commands) {
      switch (command.type) {
        // Several of the SVG commands can be represented/recreated with the same KCL
        // commands, so we end up grouping these together. Ideally, we'd have a 1:1
        // mapping between SVG and KCL just so I could wrap my head around it but...
        // what can you do?

        // Start sketch command.
        case CommandType.MoveAbsolute:
        case CommandType.MoveRelative: {
          if (isFirstCommand) {
            isFirstCommand = false
            // this.currentPoint = command.position
          }
          this.writeStartSketch(command.position, isHole)
          break
        }

        // Line command.
        case CommandType.LineAbsolute:
        case CommandType.LineRelative:
        case CommandType.HorizontalLineAbsolute:
        case CommandType.HorizontalLineRelative:
        case CommandType.VerticalLineAbsolute:
        case CommandType.VerticalLineRelative: {
          this.writeLine(command.position)
          break
        }

        // Bezier curve commands - 'normal'.
        case CommandType.QuadraticBezierAbsolute:
        case CommandType.QuadraticBezierRelative: {
          this.writeQuadraticBezierCurve(command)
          break
        }

        case CommandType.CubicBezierAbsolute:
        case CommandType.CubicBezierRelative: {
          this.writeCubicBezierCurve(command)
          break
        }

        // Bezier curve commands - 'smooth'; these use the previous control point.
        case CommandType.QuadraticBezierSmoothAbsolute:
        case CommandType.QuadraticBezierSmoothRelative: {
          this.writeSmoothQuadraticBezierCurve(command)
          break
        }

        case CommandType.CubicBezierSmoothAbsolute:
        case CommandType.CubicBezierSmoothRelative: {
          this.writeSmoothCubicBezierCurve(command)
          break
        }

        // Elliptical arc commands.
        // Uh-oh.

        // Close path commands.
        case CommandType.StopAbsolute:
        case CommandType.StopRelative: {
          if (isHole) {
            this.addCommand('|> close(%), %)')
          } else {
            this.addCommand('|> close(%)\n')
          }
          break
        }
      }
    }

    // Ensure path is closed.
    if (
      !commands.some(
        (cmd) => cmd.type === CommandType.StopAbsolute || cmd.type === CommandType.StopRelative
      )
    ) {
      if (isHole) {
        this.addCommand('  |> close(%), %)')
      } else {
        this.addCommand('|> close(%)\n')
      }
    }
  }

  public processPath(path: ParsedPath): void {
    if (path.fillRule === 'evenodd') {
      const subpaths = this.separateSubpaths(path)
      const [outer, ...inner] = subpaths

      // Write outer path.
      this.writeSubpath(outer.commands)

      // Write inner paths as holes.
      for (const innerPath of inner) {
        this.writeSubpath(innerPath.commands, true)
      }
    } else {
      // For nonzero, check winding directions.
      const subpaths = this.separateSubpaths(path)
      const [outer, ...inner] = subpaths

      // Separate inner paths by winding direction.
      const holes = inner.filter((p) => p.isClockwise !== outer.isClockwise)
      const separate = inner.filter((p) => p.isClockwise === outer.isClockwise)

      // Write outer path with holes.
      this.writeSubpath(outer.commands)
      for (const hole of holes) {
        this.writeSubpath(hole.commands, true)
      }

      // Write separate shapes.
      for (const path of separate) {
        this.writeSubpath(path.commands)
      }
    }
  }

  public generateOutput(): string {
    return this.commands.join('\n')
  }
}
