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

import { FillRule, Point } from '../types/base'
import { PathElement } from '../types/elements'
import { PathCommand, PathCommandType } from '../types/path'
import { BezierUtils } from '../utils/bezier'
import {
  EnrichedCommand,
  findSelfIntersections,
  interpolateLine,
  Intersection,
  EPSILON_INTERSECT
} from '../utils/geometry'

interface PathFragment {
  // An internal, intermediate representation of a path 'fragment'. We may produce
  // a bunch of these when splitting paths, but we need more context than would be
  // provided by the sort of new PathCommand object we produce when re-emitting
  // quasi-SVG.

  // SVG paths are lines, Béziers or arcs. We don't support arcs, and we can simplify
  // things by only considering absolute coordinates and mopping up smoothed
  // (i.e. reflected control point) curves at the layer above this. So.. simple type.
  type: 'line' | 'quad' | 'cubic'

  // The main points for this geometry:
  start: Point
  end: Point

  // Optionally store additional data for Bézier curves.
  control1?: Point
  control2?: Point

  // Store a link to the original command index in our input path list.
  commandIndex: number
}

interface PathSampleResult {
  // Represents a sampled path for self-intersection detection.
  points: Point[]
  commands: EnrichedCommand[]
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
    const { points, commands } = this.buildPath()

    // Get the intersections. Note that segment index values here refer to the sampled
    // path, not the original commands.
    const intersections = findSelfIntersections(points)

    // Start building the split plan. This is a map of command indices to arrays of
    // t-values where the command should be split.
    let splitPlan = new Map<number, number[]>()

    for (const intersection of intersections) {
      // Pull the sampled path segment indices for the intersecting segments. These
      // are the indices in the sampled path (output of buildPath()).
      const iSegmentA = intersection.iSegmentA
      const iSegmentB = intersection.iSegmentB

      // Get the commands that 'own' these points.
      const iCommandA = this.findCommandIndexForPoint(commands, iSegmentA)
      const iCommandB = this.findCommandIndexForPoint(commands, iSegmentB)

      // Convert segment-relative t-values into original command t-values.
      const tA = this.convertSegmentTtoCommandT(commands, iSegmentA, intersection.tA)
      const tB = this.convertSegmentTtoCommandT(commands, iSegmentB, intersection.tB)

      // Add t1 to command A's split points.
      if (!splitPlan.has(iCommandA)) {
        splitPlan.set(iCommandA, [])
      }
      splitPlan.get(iCommandA)!.push(tA)

      // Add t2 to command B's split points.
      if (!splitPlan.has(iCommandB)) {
        splitPlan.set(iCommandB, [])
      }
      splitPlan.get(iCommandB)!.push(tB)
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
  private buildPath(): PathSampleResult {
    const points: Point[] = []
    const commands: EnrichedCommand[] = []
    let currentPoint = { x: 0, y: 0 }

    for (const command of this.inputCommands) {
      // Get the (global point set) index of this command's first point.
      const iFirstPoint = points.length

      switch (command.type) {
        case PathCommandType.MoveAbsolute:
        case PathCommandType.MoveRelative: {
          points.push(command.position)
          currentPoint = command.position
          break
        }

        case PathCommandType.LineAbsolute:
        case PathCommandType.LineRelative:
        case PathCommandType.HorizontalLineAbsolute:
        case PathCommandType.HorizontalLineRelative:
        case PathCommandType.VerticalLineAbsolute:
        case PathCommandType.VerticalLineRelative: {
          points.push(currentPoint, command.position)
          currentPoint = command.position
          break
        }

        case PathCommandType.QuadraticBezierAbsolute:
        case PathCommandType.QuadraticBezierRelative: {
          // Get absolute control point.
          let [x1, y1] = command.parameters
          if (command.type === PathCommandType.QuadraticBezierRelative) {
            x1 += currentPoint.x
            y1 += currentPoint.y
          }

          // Sample the curve.
          const sampledPoints = BezierUtils.sampleQuadraticBezier(
            currentPoint,
            { x: x1, y: y1 },
            command.position
          )
          points.push(...sampledPoints)
          currentPoint = command.position
          break
        }
      }

      // Get the (global point set) index of this command's last point.
      const iLastPoint = points.length - 1

      // Append to our enriched commands.
      commands.push({
        ...command,
        iFirstPoint,
        iLastPoint
      })
    }

    return { points, commands }
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

  private findCommandIndexForPoint(commands: EnrichedCommand[], iPoint: number): number {
    // Look through commands to find which one contains this point index.
    for (let i = 0; i < commands.length; i++) {
      const command = commands[i]
      if (iPoint >= command.iFirstPoint && iPoint <= command.iLastPoint) {
        return i
      }
    }
    throw new Error(`No command found containing point index ${iPoint}`)
  }

  private convertSegmentTtoCommandT(
    commands: EnrichedCommand[],
    iSegmentStart: number,
    tLocal: number
  ): number {
    // Converts a localised segment T value to a global (command scope) T value.

    // Find the command that owns this segment.
    const iCommand = this.findCommandIndexForPoint(commands, iSegmentStart)
    const command = commands[iCommand]

    // If it's a line, segment t is already correct.
    if (command.type.includes('Line') || command.type.includes('Move')) {
      return tLocal
    }

    // For Bézier curves, we need to map from sample segment space (local) to curve
    // space (global).
    // For example, if we have a sampled cubic Bézier with 5 points, and a point of
    // intersection lying halfway between points 1 and 2:
    //
    // |---|---|---|---|
    // 0   1 X 2   3   4
    //
    // Then we would expect a local t value of 0.5, and an iSegmentStart of 1.
    //
    // We need to map this to the curve's space, so we want to:
    // 1. Work out how long the command is in terms of sampled points.
    // 2. Work out how far along the command our intersection point is.
    //
    // We just need to 'localise' our starting point as our iSegmentStart could be
    // some arbitrary value, not necessarily 0.

    // Get the length of the command as sampled.
    const lCommand = command.iLastPoint - command.iFirstPoint

    // Then we want to work out how far along the command this point is.
    const lToIntersection = iSegmentStart - command.iFirstPoint + tLocal
    const tGlobal = lToIntersection / lCommand

    return tGlobal
  }

  // First pass.
  // -----------------------------------------------------------------------------------
  public analyzePath(): void {
    // Build sampled path we'll use for self-intersection detection.
    const { points, commands } = this.buildPath()

    // Get the intersections. Note that segment index values here refer to the sampled
    // path, not the original commands.
    this.intersections = findSelfIntersections(points)

    // Start building the split plan. This is a map of command indices to arrays of
    // t-values where the command should be split.
    let splitPlan = new Map<number, number[]>()

    for (const intersection of this.intersections) {
      // Each intersection has two colliding segments: A and B. Pull the sampled path
      // segment indices for these intersecting segments
      const iSegmentA = intersection.iSegmentA
      const iSegmentB = intersection.iSegmentB

      // Find the index of the original commands that 'own' segmentA and segmentB.
      const iCommandA = this.findCommandIndexForPoint(commands, iSegmentA)
      const iCommandB = this.findCommandIndexForPoint(commands, iSegmentB)

      // Convert segment-relative t-values into original command t-values.
      const tA = this.convertSegmentTtoCommandT(commands, iSegmentA, intersection.tA)
      const tB = this.convertSegmentTtoCommandT(commands, iSegmentB, intersection.tB)

      // Store in splitPlan. Each command index gets a list of T-values to split at.
      if (!splitPlan.has(iCommandA)) {
        splitPlan.set(iCommandA, [])
      }
      splitPlan.get(iCommandA)!.push(tA)

      if (!splitPlan.has(iCommandB)) {
        splitPlan.set(iCommandB, [])
      }
      splitPlan.get(iCommandB)!.push(tB)
    }

    // After collecting all splits, sort each command's t-values.
    for (const tValues of splitPlan.values()) {
      tValues.sort((a, b) => a - b)
    }

    // Set the split plan.
    this.splitPlan = splitPlan

    // ---------------------------------------------------------------------------------

    // Let's do some subdivision.
    const fragments: PathFragment[] = []
    for (let i = 0; i < commands.length; i++) {
      const cmd = commands[i]

      // Pull out the t-values for this command, plus ensure 0 & 1 are included.
      // This is so our later subdivide calls can see the whole thing.
      const tVals = [...(splitPlan.get(i) || []), 0, 1]

      // Sort.
      tVals.sort((a, b) => a - b)

      // For each adjacent pair of t-values, produce one fragment.
      for (let j = 0; j < tVals.length - 1; j++) {
        const tMin = tVals[j]
        const tMax = tVals[j + 1]
        if (tMax - tMin < EPSILON_INTERSECT) {
          // Skip trivial zero-length splits from repeated t-values. Should hopefully
          // not see any of this since the intersection finder should have removed them.
          continue
        }

        // Subdivide this command from [tMin..tMax] into a PathFragment.
        const fragment = this.subdivideCommand(cmd, points, tMin, tMax)
        if (fragment) {
          fragments.push(fragment)
        }
      }
    }
  }

  private subdivideCommand(
    command: EnrichedCommand,
    points: Point[],
    tMin: number,
    tMax: number
  ): PathFragment | null {
    // We only handle lines, quadratics, and cubics here.
    // If other commands (Move, Arc, etc.) appear, return null or handle them as needed.
    if (command.type.includes('Line')) {
      return this.subdivideLine(command, points, tMin, tMax)
    } else if (command.type.includes('QuadraticBezier')) {
      //   return this.subdivideQuadratic(command, points, tMin, tMax)
    } else if (command.type.includes('CubicBezier')) {
      //   return this.subdivideCubic(command, points, tMin, tMax)
    }

    return null
  }

  private subdivideLine(
    cmd: EnrichedCommand,
    points: Point[],
    tMin: number,
    tMax: number
  ): PathFragment {
    // Line absolute is draw from current point to the specified coords.
    const currentPoint = cmd.position

    const startPt = { x: 0, y: 0 }
    const endPt = { x: 0, y: 0 }

    return {
      type: 'line',
      start: startPt,
      end: endPt,
      commandIndex: cmd.iFirstPoint // or cmd.commandIndex if you track that
    }
  }
}
