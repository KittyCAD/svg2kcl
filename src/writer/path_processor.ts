import { PathCommand, PathCommandType } from '../types/path'
import { Point } from '../types/base'
import { PathElement } from '../types/elements'
import { FillRule } from '../types/base'
import { BezierUtils } from '../utils/bezier'
import { findSelfIntersections } from '../utils/geometry'
import { IntersectionInfo } from '../utils/geometry'

interface PathSegment {
  points: Point[]
  command: PathCommand // Keep reference to original command.
  startIndex: number // Index where this segment starts in flattened points.
}

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

    // Build sampled path we'll use for self-intersection detection.
    const segments = this.buildPath()
    const segmentStartIndices = segments.flatMap((x) => x.startIndex)
    const allPoints = segments.flatMap((x) => x.points)

    const intersections = findSelfIntersections(allPoints)

    // Map intersections to original segments
    for (const intersection of intersections) {
      const segmentIndex1 = this.findSegmentIndexForPoint(
        segmentStartIndices,
        intersection.segmentIndex1
      )
      const segmentIndex2 = this.findSegmentIndexForPoint(
        segmentStartIndices,
        intersection.segmentIndex2
      )

      const command1 = segments[segmentIndex1].command
      const command2 = segments[segmentIndex2].command
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
        // this.processQuadraticBezierSmoothCommand(command)
        break

      case PathCommandType.CubicBezierAbsolute:
      case PathCommandType.CubicBezierRelative:
        // this.processCubicBezierCommand(command)
        break

      case PathCommandType.CubicBezierSmoothAbsolute:
      case PathCommandType.CubicBezierSmoothRelative:
        // this.processCubicBezierSmoothCommand(command)
        break

      case PathCommandType.StopAbsolute:
      case PathCommandType.StopRelative:
        // this.processStopCommand(command)
        break
    }
  }

  private findSegmentIndexForPoint(segmentStartIndices: number[], pointIndex: number): number {
    // This could be binary search but meh.
    for (let i = segmentStartIndices.length - 1; i >= 0; i--) {
      if (segmentStartIndices[i] <= pointIndex) {
        return i
      }
    }
    return -1
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

  // Build the whole thing for self-intersection detection.
  // -----------------------------------------------------------------------------------
  private buildPath(): PathSegment[] {
    const segments: PathSegment[] = []
    let currentPoint = { x: 0, y: 0 }
    let startIndex = 0

    for (const command of this.inputCommands) {
      let points: Point[] = []

      switch (command.type) {
        case PathCommandType.MoveAbsolute:
        case PathCommandType.MoveRelative: {
          // Just a single point for moves
          points = [command.position]
          currentPoint = command.position
          break
        }

        case PathCommandType.LineAbsolute:
        case PathCommandType.LineRelative:
        case PathCommandType.HorizontalLineAbsolute:
        case PathCommandType.HorizontalLineRelative:
        case PathCommandType.VerticalLineAbsolute:
        case PathCommandType.VerticalLineRelative: {
          // Two points for lines
          points = [currentPoint, command.position]
          currentPoint = command.position
          break
        }

        case PathCommandType.QuadraticBezierAbsolute:
        case PathCommandType.QuadraticBezierRelative: {
          // Get absolute control point
          let [x1, y1] = command.parameters
          if (command.type === PathCommandType.QuadraticBezierRelative) {
            x1 += currentPoint.x
            y1 += currentPoint.y
          }

          // Sample the curve
          points = BezierUtils.sampleQuadraticBezier(
            currentPoint,
            { x: x1, y: y1 },
            command.position
          )

          currentPoint = command.position
          break
        }
      }

      if (points.length > 0) {
        segments.push({
          points,
          command,
          startIndex
        })
        startIndex += points.length
      }
    }

    return segments
  }

  // The harder bits.
  // -----------------------------------------------------------------------------------
  private processQuadraticBezierCommand(command: PathCommand): void {
    const previousControl: Point = this.getPreviousControlPoint()

    // Pull SVG spec params: https://www.w3.org/TR/SVG2/paths.html#PathDataCubicBezierCommands
    let [x1, y1, x, y] = command.parameters

    if (command.type === PathCommandType.QuadraticBezierRelative) {
      // We need absolute for self-intersection detection and splitting.
      x1 += this.currentPoint.x
      y1 += this.currentPoint.y
    }

    // Get our points.
    const p0 = this.currentPoint
    const p1 = {
      x: x1,
      y: y1
    }
    const p2 = command.position

    // Sample the curve.
    const samples = BezierUtils.sampleQuadraticBezier(p0, p1, p2)

    // Update output buffer.
    this.outputCommands.push(command)

    // Update state: current point becomes our endpoint, previous control point becomes
    // current control point.
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
