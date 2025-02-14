// So I think the broad process here will involve three passes:
//
// First Pass - Path Analysis:
// - Walk path collecting all points/commands using buildPath().
// - Find all self-intersections using findSelfIntersections().
// - Create list of path segments between intersections.
// - Create region graph where each closed region has:
//   - Boundary points.
//   - Contributing path segments with references to original commands.
//   - References to neighboring regions.
//   - Initial fill status (unset).
//
// Second Pass - Winding Calculation:
// - For each region:
//   - Pick a test point inside the region (e.g., centroid).
//   - Cast ray to right from test point.
//   - Walk original path in order, counting signed crossings:
//     - +1 for upward crossing with point on left.
//     - -1 for downward crossing with point on right.
//   - Store winding number for region.
//   - Set fill status based on winding number (!= 0 means fill, hence 'nonzero').
//
// Third Pass - Region Relationship Analysis:
// Because our kcl `hole` command is a hole in _something_, we need to know about
// parent-child relationships between regions. So:
// - For each unfilled region (wn = 0):
//   - Find all neighboring filled regions.
//   - Determine which filled region this is a hole in.
//   - Store parent-child relationship between regions.
//
// Fourth Pass - Region Processing:
// - Process regions in correct order:
//   - Start with outermost filled regions.
//   - For each filled region:
//     - Generate its sketch commands.
//     - Generate hole commands for all holes belonging to this region.
//     - Ensure each hole command references its parent sketch.
//   - Move to next filled region.
//
// Finally:
// - Return processed commands where:
//   - Each hole is properly associated with its parent shape
//   - Holes are cut from the correct shapes
//   - Order guarantees parent shapes exist before their holes
//

import { PathCommand, PathCommandType } from '../types/path'
import { Point } from '../types/base'
import { PathElement } from '../types/elements'
import { FillRule } from '../types/base'
import { BezierUtils } from '../utils/bezier'
import { findSelfIntersections, Intersection, SampledPathSegment } from '../utils/geometry'
import { interpolateLine } from '../utils/geometry'

interface Region {
  id: number
  boundaryPoints: Point[] // Boundary points defining the region outline.
  segments: SampledPathSegment[] // Segments that make up this region, in order.
  intersections: Intersection[] // Intersections where this region begins/ends.
  neighbors: Set<number> // IDs of regions that share boundaries with this one.

  // Will be set in later passes.
  windingNumber?: number
  isFilled?: boolean
  parentRegionId?: number
  childRegionIds: Set<number>
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
  private splitPlan: Map<number, number[]> = new Map()
  private intersections: Intersection[] = []

  constructor(element: PathElement) {
    // Pull commands and fill rule.
    this.inputCommands = [...element.commands]
    this.fillRule = element.fillRule as FillRule
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
    this.splitPlan = new Map()

    // Get out early for evenodd fill rule—no splitting required!
    if (this.fillRule === FillRule.EvenOdd) {
      return this.inputCommands
    }

    // Build sampled path we'll use for self-intersection detection.
    const commandSegments = this.buildPath() // One segment entry per command.
    const segmentStartIndices = commandSegments.flatMap((x) => x.startIndex)
    const sampledFullPath = commandSegments.flatMap((x) => x.points)

    // Get the intersections. Note that segment index values here refer to the sampled
    // path, not the original commands.
    const intersections = findSelfIntersections(sampledFullPath)

    // Map from command index to array of t-values where it needs to be split.
    let splitPlan = new Map<number, number[]>()

    for (const intersection of intersections) {
      const commandAIndex = this.findSegmentIndexForPoint(
        segmentStartIndices,
        intersection.segmentAIndex
      )
      const commandBIndex = this.findSegmentIndexForPoint(
        segmentStartIndices,
        intersection.segmentBIndex
      )

      // Add t1 to command A's split points.
      if (!splitPlan.has(commandAIndex)) {
        splitPlan.set(commandAIndex, [])
      }
      splitPlan.get(commandAIndex)!.push(intersection.tA)

      // Add t2 to command B's split points.
      if (!splitPlan.has(commandBIndex)) {
        splitPlan.set(commandBIndex, [])
      }
      splitPlan.get(commandBIndex)!.push(intersection.tB)
    }

    // After collecting all splits, sort each command's t-values.
    for (const tValues of splitPlan.values()) {
      tValues.sort((a, b) => a - b)
    }

    // Set the split plan.
    this.splitPlan = splitPlan

    // Otherwise... step across the input commands—simple for loop for debug easiness.
    for (let i = 0; i < this.inputCommands.length; i++) {
      const command = this.inputCommands[i]
      this.processCommand(command, i)
    }

    return this.outputCommands
  }

  private processCommand(command: PathCommand, iCommand: number): void {
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
        this.processLineCommand(command, iCommand)
        break

      case PathCommandType.QuadraticBezierAbsolute:
      case PathCommandType.QuadraticBezierRelative:
        this.processQuadraticBezierCommand(command, iCommand)
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

  // More straightforward commands.
  // -----------------------------------------------------------------------------------
  private processMoveCommand(command: PathCommand): void {
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

  private processLineCommand(command: PathCommand, iCommand: number): void {
    const splitRequired = this.splitPlan.has(iCommand)
    const splitData = this.splitPlan.get(iCommand) || []

    if (!splitRequired) {
      // No splitting needed, push the original line command.
      this.outputCommands.push(command)
    } else {
      // Sort t-values to ensure they are processed in order.
      splitData.sort((a, b) => a - b)

      let startPoint = this.currentPoint

      for (const t of splitData) {
        const midPoint = interpolateLine(startPoint, command.position, t)

        // All line segments become LineAbsolute since we have absolute coords.
        this.outputCommands.push({
          type: PathCommandType.LineAbsolute,
          parameters: [midPoint.x, midPoint.y],
          position: midPoint
        })

        startPoint = midPoint
      }

      // Final segment.
      this.outputCommands.push({
        type: PathCommandType.LineAbsolute,
        parameters: [command.position.x, command.position.y],
        position: command.position
      })
    }

    // Update state.
    this.currentPoint = command.position
    this.clearPreviousControlPoint()
  }
  // Build the whole thing for self-intersection detection.
  // -----------------------------------------------------------------------------------
  private buildPath(): SampledPathSegment[] {
    const segments: SampledPathSegment[] = []
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
          sourceCommand: command,
          startIndex
        })
        startIndex += points.length
      }
    }

    return segments
  }

  // The harder bits.
  // -----------------------------------------------------------------------------------
  private processQuadraticBezierCommand(command: PathCommand, iCommand: number): void {
    const splitRequired = this.splitPlan.has(iCommand)
    const splitData = this.splitPlan.get(iCommand) || []

    // Get absolute control point
    let [x1, y1, x, y] = command.parameters

    if (command.type === PathCommandType.QuadraticBezierRelative) {
      x1 += this.currentPoint.x
      y1 += this.currentPoint.y
    }

    // Get our points.
    const p0 = this.currentPoint
    const p1 = { x: x1, y: y1 }
    const p2 = command.position

    if (!splitRequired) {
      // No splits, just push the original command.
      this.outputCommands.push(command)
    } else {
      // Sort the split points just in case they are out of order.
      splitData.sort((a, b) => a - b)

      let startPoint = { x: p0.x, y: p0.y }
      let controlPoint = { x: p1.x, y: p1.y }
      let endPoint = { x: p2.x, y: p2.y }

      for (const t of splitData) {
        const splitResult = BezierUtils.splitQuadraticBezier(
          { start: startPoint, control: controlPoint, end: endPoint },
          t
        )

        // Push first half.
        // Parameters are control point and end point.
        const parameters = [
          splitResult.first[1].x,
          splitResult.first[1].y,
          splitResult.first[2].x,
          splitResult.first[2].y
        ]
        this.outputCommands.push({
          type: PathCommandType.QuadraticBezierAbsolute,
          parameters: parameters,
          position: splitResult.first[2] // End point.
        })

        // Update start point for the next segment.
        startPoint = splitResult.second[0]
        controlPoint = splitResult.second[1]
      }

      // Push last segment.
      this.outputCommands.push({
        type: PathCommandType.QuadraticBezierAbsolute,
        parameters: [controlPoint.x, controlPoint.y, endPoint.x, endPoint.y],
        position: endPoint
      })
    }

    // Update state.
    this.currentPoint = p2
    this.setPreviousControlPoint(p1)
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

  // First pass.
  // -----------------------------------------------------------------------------------
  private analyzePath(): void {}

  private findAllIntersections(): void {
    const segments = this.buildPath()
    const points = segments.flatMap((s) => s.points)
    const segmentStartIndices = segments.map((s) => s.startIndex)

    // Get raw intersections.
    const rawIntersections = findSelfIntersections(points)

    // Enhance the intersections with segment information.
    this.intersections = rawIntersections.map((intersection) => {
      const segmentAIndex = this.findSegmentIndexForPoint(
        segmentStartIndices,
        intersection.segmentAIndex
      )
      const segmentBIndex = this.findSegmentIndexForPoint(
        segmentStartIndices,
        intersection.segmentBIndex
      )

      // Enrich the intersection with segment information.
      return {
        ...intersection,
        segments: {
          a: segments[segmentAIndex],
          b: segments[segmentBIndex]
        }
      }
    })

    // Sort intersections by t-value within each segment.
    this.intersections.sort((a, b) => {
      if (a.segments!.a === b.segments!.a) {
        return a.tA - b.tA
      }
      return a.segments!.a.startIndex - b.segments!.a.startIndex
    })
  }
}
