import { FillRule, Point } from '../types/base'
import { PathCommandType, SVGPathCommandMap } from '../types/path'
import { Transform } from '../utils/transform'

const DEFAULT_FILL_RULE = FillRule.EvenOdd

const UNSUPPORTED_COMMANDS = [
  PathCommandType.EllipticalArcAbsolute,
  PathCommandType.EllipticalArcRelative
]

export class PathParseError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PathParseError'
  }
}

export interface ParsedCommand {
  type: PathCommandType
  parameters: number[]
  position: Point
}

export interface ParsedPath {
  commands: ParsedCommand[]
  startPosition: Point
  fillRule: FillRule
}

interface PathState {
  command: PathCommandType
  values: number[]
  valueBuffer: string
  currentPoint: Point
  isPathOpen: boolean
  isValuePushed: boolean
}

export class SVGPathParser {
  private state: PathState
  private path!: ParsedPath
  private transform: Transform

  constructor() {
    this.transform = new Transform()
    this.state = {
      command: PathCommandType.NotSet,
      values: [],
      valueBuffer: '',
      currentPoint: { x: 0, y: 0 },
      isPathOpen: false,
      isValuePushed: true
    }
  }

  private resetState(): void {
    this.state = {
      command: PathCommandType.NotSet,
      values: [],
      valueBuffer: '',
      currentPoint: { x: 0, y: 0 },
      isPathOpen: false,
      isValuePushed: true
    }
  }

  private applyTransform(point: Point): Point {
    if (!this.transform) return point

    // TODO: Add an apply method to the Transform class.
    return {
      x:
        this.transform.matrix.a * point.x +
        this.transform.matrix.c * point.y +
        this.transform.matrix.e,
      y:
        this.transform.matrix.b * point.x +
        this.transform.matrix.d * point.y +
        this.transform.matrix.f
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
    const command = SVGPathCommandMap[char]

    // Check if this command is supported.
    if (UNSUPPORTED_COMMANDS.includes(command)) {
      throw new PathParseError(`Unsupported path command: ${command}`)
    }

    // 1. Push any pending value from previous command.
    this.pushValue()

    // 2. Process previous command if there was one.
    if (this.state.command !== PathCommandType.NotSet) {
      this.handleCommand()
    }

    // 3. Set new command.
    this.state.command = command

    // 4. Clear values for new command.
    this.state.values = []
    this.state.isValuePushed = false

    // 5. For commands that don't need values (like z/Z), process them immediately.
    if (
      this.state.command === PathCommandType.StopAbsolute ||
      this.state.command === PathCommandType.StopRelative
    ) {
      this.processValues([])
    }
  }

  private handleNegative(): void {
    if (this.isValidNegative()) {
      this.pushValue()
    }
    this.state.valueBuffer = '-'
  }

  private handleChar(char: string): void {
    if (char in SVGPathCommandMap) {
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

  private transformParameters(parameters: number[]): number[] {
    // Don't transform if no transform matrix.
    if (!this.transform) return parameters

    // Transform pairs of coordinates.
    const transformed: number[] = []
    for (let i = 0; i < parameters.length; i += 2) {
      if (i + 1 < parameters.length) {
        // If we have a pair of coordinates, transform them.
        const point = this.applyTransform({ x: parameters[i], y: parameters[i + 1] })
        transformed.push(point.x, point.y)
      } else {
        // For single values (like in H/V commands), pass through.
        transformed.push(parameters[i])
      }
    }
    return transformed
  }

  private processValues(parameters: number[]): void {
    let transformedParameters = [...parameters]

    // Transform absolute coordinates.
    switch (this.state.command) {
      case PathCommandType.MoveAbsolute:
      case PathCommandType.LineAbsolute:
      case PathCommandType.CubicBezierAbsolute:
      case PathCommandType.QuadraticBezierAbsolute:
      case PathCommandType.EllipticalArcAbsolute:
        transformedParameters = this.transformParameters(parameters)
        break
      case PathCommandType.HorizontalLineAbsolute:
        if (this.transform) {
          // For H, transform considering current X.
          transformedParameters = [
            this.applyTransform({ x: parameters[0], y: this.state.currentPoint.y }).x
          ]
        }
        break
      case PathCommandType.VerticalLineAbsolute:
        if (this.transform) {
          // For V, transform considering current Y.
          transformedParameters = [
            this.applyTransform({ x: this.state.currentPoint.x, y: parameters[0] }).y
          ]
        }
        break
    }

    // Update currentPoint for absolute commands.
    switch (this.state.command) {
      case PathCommandType.MoveAbsolute:
      case PathCommandType.LineAbsolute:
        this.state.currentPoint = { x: transformedParameters[0], y: transformedParameters[1] }
        if (this.state.command === PathCommandType.MoveAbsolute && !this.path.commands.length) {
          this.path.startPosition = { ...this.state.currentPoint }
        }
        break
      case PathCommandType.HorizontalLineAbsolute:
        this.state.currentPoint.x = transformedParameters[0]
        break
      case PathCommandType.VerticalLineAbsolute:
        this.state.currentPoint.y = transformedParameters[0]
        break
      case PathCommandType.CubicBezierAbsolute:
        this.state.currentPoint = { x: transformedParameters[4], y: transformedParameters[5] }
        break
      case PathCommandType.QuadraticBezierAbsolute:
        this.state.currentPoint = { x: transformedParameters[2], y: transformedParameters[3] }
        break
      case PathCommandType.CubicBezierSmoothAbsolute:
        this.state.currentPoint = { x: transformedParameters[2], y: transformedParameters[3] }
        break
      case PathCommandType.QuadraticBezierSmoothAbsolute:
        this.state.currentPoint = { x: transformedParameters[0], y: transformedParameters[1] }
        break
      case PathCommandType.EllipticalArcAbsolute:
        this.state.currentPoint = { x: transformedParameters[5], y: transformedParameters[6] }
        break
    }

    // Update currentPoint for relative commands.
    switch (this.state.command) {
      case PathCommandType.MoveRelative:
      case PathCommandType.LineRelative:
        this.state.currentPoint.x += parameters[0]
        this.state.currentPoint.y += parameters[1]
        if (this.state.command === PathCommandType.MoveRelative && !this.path.commands.length) {
          this.path.startPosition = { ...this.state.currentPoint }
        }
        break
      case PathCommandType.HorizontalLineRelative:
        this.state.currentPoint.x += parameters[0]
        break
      case PathCommandType.VerticalLineRelative:
        this.state.currentPoint.y += parameters[0]
        break
      case PathCommandType.CubicBezierRelative:
        this.state.currentPoint.x += parameters[4]
        this.state.currentPoint.y += parameters[5]
        break
      case PathCommandType.QuadraticBezierRelative:
        this.state.currentPoint.x += parameters[2]
        this.state.currentPoint.y += parameters[3]
        break
      case PathCommandType.CubicBezierSmoothRelative:
        this.state.currentPoint.x += parameters[2]
        this.state.currentPoint.y += parameters[3]
        break
      case PathCommandType.QuadraticBezierSmoothRelative:
        this.state.currentPoint.x += parameters[0]
        this.state.currentPoint.y += parameters[1]
        break
      case PathCommandType.EllipticalArcRelative:
        this.state.currentPoint.x += parameters[5]
        this.state.currentPoint.y += parameters[6]
        break
      case PathCommandType.StopAbsolute:
      case PathCommandType.StopRelative:
        this.state.currentPoint = { ...this.path.startPosition }
        break
    }

    // Push the command with transformed values for absolute commands.
    this.path.commands.push({
      type: this.state.command,
      parameters: this.state.command.endsWith('Absolute') ? transformedParameters : parameters,
      position: { ...this.state.currentPoint }
    })
  }

  private handleCommand(): void {
    const parameterCountMap = {
      [PathCommandType.MoveAbsolute]: 2,
      [PathCommandType.MoveRelative]: 2,
      [PathCommandType.LineAbsolute]: 2,
      [PathCommandType.LineRelative]: 2,
      [PathCommandType.HorizontalLineAbsolute]: 1,
      [PathCommandType.HorizontalLineRelative]: 1,
      [PathCommandType.VerticalLineAbsolute]: 1,
      [PathCommandType.VerticalLineRelative]: 1,
      [PathCommandType.CubicBezierAbsolute]: 6,
      [PathCommandType.CubicBezierRelative]: 6,
      [PathCommandType.CubicBezierSmoothAbsolute]: 4,
      [PathCommandType.CubicBezierSmoothRelative]: 4,
      [PathCommandType.QuadraticBezierAbsolute]: 4,
      [PathCommandType.QuadraticBezierRelative]: 4,
      [PathCommandType.QuadraticBezierSmoothAbsolute]: 2,
      [PathCommandType.QuadraticBezierSmoothRelative]: 2,
      [PathCommandType.EllipticalArcAbsolute]: 7,
      [PathCommandType.EllipticalArcRelative]: 7,
      [PathCommandType.StopAbsolute]: 0,
      [PathCommandType.StopRelative]: 0
    }

    if (
      this.state.command === PathCommandType.NotSet ||
      (this.state.values.length === 0 && parameterCountMap[this.state.command] > 0)
    ) {
      return
    }

    let nParams = parameterCountMap[this.state.command] || 2

    // Process values in groups based on the expected parameter count.
    for (let i = 0; i < this.state.values.length; i += nParams) {
      const parameters = this.state.values.slice(i, i + nParams)
      if (parameters.length === nParams) {
        this.processValues(parameters)
      }
    }
  }

  public parsePath(
    pathData: string,
    transform: Transform,
    inheritedFillRule?: FillRule
  ): ParsedPath {
    // Reset.
    this.transform = transform
    this.resetState()

    this.path = {
      commands: [],
      startPosition: { x: 0, y: 0 },
      fillRule: inheritedFillRule || DEFAULT_FILL_RULE
    }

    // Read.
    for (const char of pathData) {
      this.handleChar(char)
    }

    this.pushValue()
    this.handleCommand()

    return this.path
  }
}
