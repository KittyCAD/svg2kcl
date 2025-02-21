import { FillRule, Point } from '../types/base'
import { PathCommandType, SvgPathCommandMap } from '../types/paths'
import { Transform } from '../utils/transform'
import { ParseError } from './exceptions'
import { PathCommand } from '../types/paths'

const DEFAULT_FILL_RULE = FillRule.NonZero

const UNSUPPORTED_COMMANDS = [
  PathCommandType.EllipticalArcAbsolute,
  PathCommandType.EllipticalArcRelative
]

export interface ParsedPath {
  commands: PathCommand[]
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

export class SvgPathParser {
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
    const command = SvgPathCommandMap[char]

    // Check if this command is supported.
    if (UNSUPPORTED_COMMANDS.includes(command)) {
      throw new ParseError(`Unsupported path command: ${command}`)
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
    if (char in SvgPathCommandMap) {
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

  private processValues(parameters: number[]): void {
    // Pull current (soon to be previous) command point.
    const previousPoint = { ...this.state.currentPoint }

    // Update currentPoint for absolute commands
    switch (this.state.command) {
      case PathCommandType.MoveAbsolute:
      case PathCommandType.LineAbsolute:
        this.state.currentPoint = { x: parameters[0], y: parameters[1] }
        if (this.state.command === PathCommandType.MoveAbsolute && !this.path.commands.length) {
          this.path.startPosition = { ...this.state.currentPoint }
        }
        break
      case PathCommandType.HorizontalLineAbsolute:
        this.state.currentPoint.x = parameters[0]
        break
      case PathCommandType.VerticalLineAbsolute:
        this.state.currentPoint.y = parameters[0]
        break
      case PathCommandType.CubicBezierAbsolute:
        this.state.currentPoint = { x: parameters[4], y: parameters[5] }
        break
      case PathCommandType.QuadraticBezierAbsolute:
        this.state.currentPoint = { x: parameters[2], y: parameters[3] }
        break
      case PathCommandType.CubicBezierSmoothAbsolute:
        this.state.currentPoint = { x: parameters[2], y: parameters[3] }
        break
      case PathCommandType.QuadraticBezierSmoothAbsolute:
        this.state.currentPoint = { x: parameters[0], y: parameters[1] }
        break
      case PathCommandType.EllipticalArcAbsolute:
        this.state.currentPoint = { x: parameters[5], y: parameters[6] }
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
        // Because we can have subpaths, we can't use current point as the end position.
        // Just zero out; will be handled by explicit closing geometry insertion.
        // See also: sampePathData() in src/paths/paths.ts
        this.state.currentPoint = { x: 0, y: 0 }
        break
    }

    // Push the command
    this.path.commands.push({
      type: this.state.command,
      parameters,
      startPositionAbsolute: previousPoint,
      endPositionAbsolute: { ...this.state.currentPoint }
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
