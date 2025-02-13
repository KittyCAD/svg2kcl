import { PathCommand, PathCommandType } from '../types/path'
import { Point } from '../types/base'
import { PathElement } from '../types/elements'
import { FillRule } from '../types/base'

export class PathProcessor {
  // Input and output buffer.
  private inputCommands: PathCommand[]
  private outputCommands: PathCommand[] = []

  // Other props of use.
  private fillRule: FillRule

  // Some state tracking. We need previous control point to handle smoothed Beziers.
  private previousControlPoint: Point | null = null
  private currentPoint: Point = { x: 0, y: 0 }

  constructor(element: PathElement) {
    // Pull commands and fill rule.
    this.inputCommands = [...element.commands]
    this.fillRule = element.fillRule as FillRule
  }

  public process(): PathCommand[] {
    // Process will be:
    // Step across the input commands.
    // For commands that require no splitting, we will convert these to the relevant
    // PathCommand and push to our output buffer.
    // For commands that do require splitting, we will call the relevant method to
    // split the command and push the results to the output buffer.

    // Reset state.
    this.outputCommands = []
    this.previousControlPoint = null
    this.currentPoint = { x: 0, y: 0 }

    // Get out early for evenodd fill rule—no splitting required!
    if (this.fillRule === FillRule.EvenOdd) {
      return this.inputCommands
    }

    // Otherwise... step across the input commands—simple for loop for debug easiness.
    for (let i = 0; i < this.inputCommands.length; i++) {
      const command = this.inputCommands[i]
      this.processCommand(command)
    }

    return []
  }

  private getPreviousControlPoint(): Point {
    if (this.previousControlPoint === null) {
      return this.currentPoint
    }

    return this.previousControlPoint
  }

  private setPreviousControlPoint(point: Point): void {
    this.previousControlPoint = {
      x: point.x,
      y: point.y
    }
  }

  private clearPreviousControlPoint(): void {
    this.previousControlPoint = null
  }

  private processCommand(command: PathCommand): void {
    switch (command.type) {
      case PathCommandType.MoveAbsolute:
      case PathCommandType.MoveRelative:
        this.processMoveCommand(command)
        break

      case PathCommandType.LineAbsolute:
      case PathCommandType.LineRelative:
      case PathCommandType.HorizontalLineAbsolute:
      case PathCommandType.HorizontalLineRelative:
      case PathCommandType.VerticalLineAbsolute:
      case PathCommandType.VerticalLineRelative:
        this.processLineCommand(command)
        break

      case PathCommandType.QuadraticBezierAbsolute:
      case PathCommandType.QuadraticBezierRelative:
        this.processQuadraticBezierCommand(command)
        break

      case PathCommandType.QuadraticBezierSmoothAbsolute:
      case PathCommandType.QuadraticBezierSmoothRelative:
        this.processQuadraticBezierSmoothCommand(command)
        break

      case PathCommandType.CubicBezierAbsolute:
      case PathCommandType.CubicBezierRelative:
        this.processCubicBezierCommand(command)
        break

      case PathCommandType.CubicBezierSmoothAbsolute:
      case PathCommandType.CubicBezierSmoothRelative:
        this.processCubicBezierSmoothCommand(command)
        break

      case PathCommandType.StopAbsolute:
      case PathCommandType.StopRelative:
        this.processStopCommand(command)
        break
    }
  }

  // Straightforward commands where we can just update the output buffer.
  // -----------------------------------------------------------------------------------
  private processMoveCommand(command: PathCommand): void {
    this.currentPoint = command.position
    this.outputCommands.push(command)

    // Not a curve.
    this.clearPreviousControlPoint()
  }

  private processLineCommand(command: PathCommand): void {
    this.currentPoint = command.position
    this.outputCommands.push(command)

    // Not a curve.
    this.clearPreviousControlPoint()
  }

  private processStopCommand(command: PathCommand): void {
    this.currentPoint = command.position
    this.outputCommands.push(command)

    // Not a curve.
    this.clearPreviousControlPoint()
  }

  // The harder bits.
  // -----------------------------------------------------------------------------------
  private processQuadraticBezierCommand(command: PathCommand): void {
    const previousControl: Point = this.getPreviousControlPoint()

    // Logic.
    const [x1, y1, x, y] = command.parameters

    // Update output buffer.
    this.outputCommands.push(command)

    // Update state.
    this.currentPoint = command.position
    this.setPreviousControlPoint({
      x: x1,
      y: y1
    })
  }

  // Some utilities.
  // -----------------------------------------------------------------------------------
  private getReflectedControlPoint(): Point {
    const prevControl = this.getPreviousControlPoint()
    const current = this.currentPoint

    return {
      x: current.x + (current.x - prevControl.x),
      y: current.y + (current.y - prevControl.y)
    }
  }
}
