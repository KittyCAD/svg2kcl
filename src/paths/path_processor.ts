// Broad process here is:
//
// Step 1 - Path Analysis:
// - Identify subpaths by finding Move commands.
// - Sample path into points for intersection testing.
// - Find all intersections:
//   - Self-intersections within each subpath.
//   - Intersections between different subpaths.
//
// Step 2 - Fragment Creation:
// - Build split plan mapping command indices to t-values.
// - Create path fragments from subpaths using split plan.
// - Build lists of viable fragment connections.
// - Sample points along each fragment.
//
// Step 3 - Region Analysis:
// - Build closed regions from connected fragments.
// - Compute winding numbers (for nonzero).
// - Determine whether each region should be a hole or not.
// - Clean up regions:
//   - Remove redundant regions, i.e. wholly contained non-hole regions.
//
// Output:
// - FragmentMap: Connected path fragments.
// - Regions: Ordered list of regions with hierarchy.
//
// We also expose methods for converting fragments to commands, which we call
// from 'above' on a per-region basis.

import { EPSILON_INTERSECT } from '../constants'
import { connectFragments } from './fragments/connector'
import { PathFragment } from './fragments/fragment'
import { sampleSubpath } from './path'
import { identifyClosedRegions, orderRegions } from './regions'
// import { detectAllPlanarFaces } from './half_edge'
import { subdivideCommand } from './subdivision'
import { FillRule, Point } from '../types/base'
import { PathElement } from '../types/elements'
import { FragmentMap, PathFragmentType } from '../types/fragments'
import { PathCommand, PathCommandEnriched, PathCommandType, Subpath } from '../types/paths'
import { PathRegion } from '../types/regions'
import {
  computePointToPointDistance,
  findIntersectionsBetweenSubpaths,
  findSelfIntersections,
  Intersection,
  isPolygonInsidePolygon
} from '../utils/geometry'
import { WindingAnalyzer, EvenOddAnalyzer } from '../utils/fillrule'
import { sampleFragment } from './fragments/fragment'
import { getRegionPoints } from './regions'
import { exportPointsToCSV, Plotter } from '../utils/debug'

const plotter = new Plotter()
export class ProcessedPath {
  constructor(private readonly fragmentMap: FragmentMap, public readonly regions: PathRegion[]) {}

  public getFragment(id: string): PathFragment {
    const fragment = this.fragmentMap.get(id)
    if (!fragment) {
      throw new Error(`Fragment ${id} not found.`)
    }
    return fragment
  }
}

export class PathProcessor {
  private readonly inputCommands: PathCommand[]
  private readonly fillRule: FillRule

  constructor(element: PathElement) {
    this.inputCommands = [...element.commands]
    this.fillRule = element.fillRule as FillRule
  }

  public process(): ProcessedPath {
    // Analyze path structure and find intersections.
    const { pathCommands, subpaths, intersections } = this.analyzePath()

    // Plot the whole path, red.
    for (const subpath of subpaths) {
      plotter.addPoints(subpath.samplePoints, 'lines', 'scatter', 'red')
      plotter.createPlot()
    }

    // Extract fragments.
    const { fragments, fragmentMap } = this.extractFragments(pathCommands, subpaths, intersections)

    // Now walk the fragment chain and resample.
    for (const fragment of fragments) {
      fragment.sampledPoints = sampleFragment(fragment)
    }

    // Export fragment points.
    // let fragmentPoints: Point[] = []
    // for (const fragment of fragments) {
    //   if (fragment.sampledPoints) {
    //     fragmentPoints.push(...fragment.sampledPoints)
    //   }
    // }
    // exportPointsToCSV(fragmentPoints, 'fragments.csv')

    // Use fragments to assemble enclosed regions, compute winding numbers.
    const regions = identifyClosedRegions(fragments, fragmentMap)

    // Plot each of the closed regions.
    // const plotter = new Plotter()
    // for (const region of regions) {
    //   const points = getRegionPoints(region, fragmentMap)
    //   plotter.addPoints(points, 'lines', 'scatter', 'blue')
    //   plotter.createPlot()
    //   let x = 1
    // }

    /// Handle fill rule.
    let processedRegions: PathRegion[] = []
    if (this.fillRule === FillRule.NonZero) {
      const windingAnalyzer = new WindingAnalyzer(fragments)
      processedRegions = windingAnalyzer.analyzeRegions(regions)
    } else if (this.fillRule === FillRule.EvenOdd) {
      const evenOddAnalyzer = new EvenOddAnalyzer(fragments)
      processedRegions = evenOddAnalyzer.analyzeRegions(regions)
    }

    // Trim out redundant regions.
    const finalRegions = this.cleanup(fragments, processedRegions)

    // Convert to commands for KCL output.
    const orderedRegions = orderRegions(finalRegions)

    return new ProcessedPath(fragmentMap, orderedRegions)
  }

  // -----------------------------------------------------------------------------------

  private analyzePath(): {
    pathCommands: PathCommandEnriched[]
    subpaths: Subpath[]
    intersections: Intersection[]
  } {
    // Ensure we have explicitly closed subpaths.
    const initialSubpaths = this.splitSubpaths(this.inputCommands)
    const closedSubpaths = initialSubpaths.map((subpath) => this.ensureClosure(subpath))

    // Sample each subpath, keep list of all commands.
    let subpaths: Subpath[] = []
    let pathCommands: PathCommandEnriched[] = []

    // Track each command on the global path command list.
    let globalCommandIndex = 0
    let globalPointIndex = 0

    for (const subpath of closedSubpaths) {
      const { pathSamplePoints: localSubpathSamplePoints, pathCommands: localSubpathCommands } =
        sampleSubpath(subpath)

      // Create our subpath object.
      subpaths.push(
        this.createSubpaths(localSubpathCommands, localSubpathSamplePoints, globalCommandIndex)
      )

      // Track all commands.
      for (const command of localSubpathCommands) {
        pathCommands.push({
          ...command,
          iFirstPoint: command.iFirstPoint !== null ? command.iFirstPoint + globalPointIndex : null,
          iLastPoint: command.iLastPoint !== null ? command.iLastPoint + globalPointIndex : null
        })
      }

      // Track the global index of the next command.
      globalCommandIndex += localSubpathCommands.length
      globalPointIndex += localSubpathSamplePoints.length
    }

    // Compute intersections.
    const intersections = this.findAllIntersections(subpaths, pathCommands)

    return { pathCommands, subpaths, intersections }
  }

  private createSubpaths(
    commands: PathCommandEnriched[],
    samplePoints: Point[],
    iFirstCommand: number
  ): Subpath {
    if (commands.length === 0 || samplePoints.length === 0) return {} as Subpath

    return {
      iFirstCommand: iFirstCommand,
      iLastCommand: iFirstCommand + commands.length - 1,
      commands: [...commands], // Copy the command references.
      samplePoints: [...samplePoints] // Copy the sample point references.
    } as Subpath
  }

  private splitSubpaths(commands: PathCommand[]): PathCommand[][] {
    const subpaths: PathCommand[][] = []
    let currentSubpath: PathCommand[] = []

    const moves = [PathCommandType.MoveAbsolute, PathCommandType.MoveRelative]
    const stops = [PathCommandType.StopAbsolute, PathCommandType.StopRelative]

    for (const cmd of commands) {
      // Start new subpath on move (unless it's the first command).
      if (moves.includes(cmd.type) && currentSubpath.length > 0) {
        subpaths.push(currentSubpath)
        currentSubpath = []
      }

      currentSubpath.push(cmd)

      // End subpath on a stop.
      if (stops.includes(cmd.type)) {
        subpaths.push(currentSubpath)
        currentSubpath = []
      }
    }

    // Handle final subpath if not ended with a stop.
    if (currentSubpath.length > 0) {
      subpaths.push(currentSubpath)
    }

    return subpaths
  }

  private ensureClosure(commands: PathCommand[]) {
    // Get our last non-stop command.
    const stops = [PathCommandType.StopAbsolute, PathCommandType.StopRelative]
    let iLastGeomCommand = -1
    for (let i = commands.length - 1; i >= 0; i--) {
      if (!stops.includes(commands[i].type)) {
        iLastGeomCommand = i
        break
      }
    }

    // Check if it meets our first command.
    const firstCommand = commands[0]
    const lastCommand = commands[iLastGeomCommand]

    if (
      computePointToPointDistance(
        lastCommand.endPositionAbsolute,
        firstCommand.endPositionAbsolute // All subpaths start with a move.
      ) <= EPSILON_INTERSECT
    ) {
      // Do nothing.
    } else {
      // Insert a new line command.
      const newCommand = {
        type: PathCommandType.LineAbsolute,
        parameters: [firstCommand.endPositionAbsolute.x, firstCommand.endPositionAbsolute.y],
        startPositionAbsolute: lastCommand.endPositionAbsolute,
        endPositionAbsolute: firstCommand.endPositionAbsolute
      }
      commands.splice(iLastGeomCommand + 1, 0, newCommand)
    }

    return commands
  }

  private extractFragments(
    pathCommands: PathCommandEnriched[],
    subpaths: Subpath[],
    intersections: Intersection[]
  ): { fragments: PathFragment[]; fragmentMap: FragmentMap } {
    const splitPlan = this.buildSplitPlan(pathCommands, intersections)
    const fragments = this.createPathFragments(subpaths, pathCommands, splitPlan)
    connectFragments(fragments, intersections)

    const fragmentMap = new Map()
    for (const fragment of fragments) {
      fragmentMap.set(fragment.id, fragment)
    }

    return { fragments, fragmentMap }
  }

  private cleanup(fragments: PathFragment[], regions: PathRegion[]): PathRegion[] {
    const regionsToRemove = new Set<string>()
    const fragmentMap = new Map(fragments.map((f) => [f.id, f]))

    for (const region of regions) {
      if (region.isHole) continue

      const parentRegion = regions.find((r) => r.id === region.parentRegionId)
      if (!parentRegion) continue
      if (parentRegion.isHole) continue

      const regionPoints = getRegionPoints(region, fragmentMap)
      const parentPoints = getRegionPoints(parentRegion, fragmentMap)

      if (isPolygonInsidePolygon(regionPoints, parentPoints)) {
        regionsToRemove.add(region.id)
      }
    }

    return regions.filter((region) => !regionsToRemove.has(region.id))
  }

  // Some utilities.
  // -----------------------------------------------------------------------------------

  public convertFragmentsToCommands(fragments: PathFragment[]): PathCommand[] {
    const commands: PathCommand[] = []

    if (fragments.length === 0) return commands

    let currentPoint = fragments[0].start

    // Start with a move to the first point.
    commands.push({
      type: PathCommandType.MoveAbsolute,
      parameters: [currentPoint.x, currentPoint.y],
      startPositionAbsolute: currentPoint,
      endPositionAbsolute: currentPoint
    })

    // Convert each fragment to appropriate command type. Note that here we have
    // a subset of commands; we're only dealing with absolute commands, and only
    // lines, quadratic Béziers, and cubic Béziers.
    for (const fragment of fragments) {
      switch (fragment.type) {
        case PathFragmentType.Line:
          commands.push({
            type: PathCommandType.LineAbsolute,
            parameters: [fragment.end.x, fragment.end.y],
            startPositionAbsolute: currentPoint,
            endPositionAbsolute: fragment.end
          })
          break

        case PathFragmentType.Quad:
          commands.push({
            type: PathCommandType.QuadraticBezierAbsolute,
            parameters: [
              fragment.control1!.x,
              fragment.control1!.y,
              fragment.end.x,
              fragment.end.y
            ],
            startPositionAbsolute: currentPoint,
            endPositionAbsolute: fragment.end
          })
          break

        case PathFragmentType.Cubic:
          commands.push({
            type: PathCommandType.CubicBezierAbsolute,
            parameters: [
              fragment.control1!.x,
              fragment.control1!.y,
              fragment.control2!.x,
              fragment.control2!.y,
              fragment.end.x,
              fragment.end.y
            ],
            startPositionAbsolute: currentPoint,
            endPositionAbsolute: fragment.end
          })
          break
      }

      currentPoint = fragment.end
    }

    // Close the path.
    commands.push({
      type: PathCommandType.StopAbsolute,
      parameters: [],
      startPositionAbsolute: currentPoint,
      endPositionAbsolute: fragments[0].start
    })

    return commands
  }

  private findCommandIndexForSegment(commands: PathCommandEnriched[], iSegment: number): number {
    // If we have points [p1, p2, p3, p4] that becomes segments
    // [[p1, p2], [p2, p3], [p3, p4]], then the point indices for each
    // segment are [iPoint1, iPoint2] = [iSegment, iSegment+1].

    // Get our point indices.
    const iPoint1 = iSegment
    const iPoint2 = iSegment + 1

    // Validate
    const validPoints = commands.filter((cmd) => cmd.iFirstPoint != null && cmd.iLastPoint != null)
    const iMin = Math.min(
      ...validPoints
        .map((cmd) => cmd.iFirstPoint)
        .filter((point): point is number => point !== null)
    )
    const iMax = Math.max(
      ...validPoints.map((cmd) => cmd.iLastPoint).filter((point): point is number => point !== null)
    )

    if (iPoint1 < iMin || iPoint1 > iMax || iPoint2 < iMin || iPoint2 > iMax) {
      throw new Error(`Index out of range for segement: ${iSegment}`)
    }

    // Iterate over commands, return that which contains both points.

    // Look through commands to find which one contains this point index.
    for (let i = 0; i < commands.length; i++) {
      const command = commands[i]
      // Only check commands that have points.
      if (
        command.iFirstPoint !== null &&
        command.iLastPoint !== null &&
        iPoint1 >= command.iFirstPoint &&
        iPoint2 <= command.iLastPoint
      ) {
        return i
      }
    }
    throw new Error(`No command found containing point index ${iSegment}`)
  }

  private convertSegmentTtoCommandT(
    commands: PathCommandEnriched[],
    iSegmentStart: number,
    tLocal: number
  ): number {
    // Converts a localised segment T value to a global (command scope) T value.

    // Find the command that owns this segment.
    const iCommand = this.findCommandIndexForSegment(commands, iSegmentStart)
    const command = commands[iCommand]

    // If it's a line, segment t is already correct.
    const skipCommands = [
      PathCommandType.LineAbsolute,
      PathCommandType.LineRelative,
      PathCommandType.HorizontalLineAbsolute,
      PathCommandType.HorizontalLineRelative,
      PathCommandType.VerticalLineAbsolute,
      PathCommandType.VerticalLineRelative
    ]
    if (skipCommands.includes(command.type)) {
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

    // For Bézier curves we need the indices - verify they exist.
    if (command.iFirstPoint === null || command.iLastPoint === null) {
      throw new Error('Cannot convert t value for command without point indices')
    }

    // Get the length of the command as sampled.
    const lCommand = command.iLastPoint - command.iFirstPoint

    // Then we want to work out how far along the command this point is.
    const lToIntersection = iSegmentStart - command.iFirstPoint + tLocal
    const tGlobal = lToIntersection / lCommand

    return tGlobal
  }

  private findAllIntersections(
    subpaths: Subpath[],
    pathCommands: PathCommandEnriched[]
  ): Intersection[] {
    const allIntersections: Intersection[] = []

    // TODO: (Maybe) Make these algebraic and not based on sampled points.
    // Find intersections within each subpath. Intersections should store segment
    // indices that correspond to the full global path sample points, which
    // are also referenced by the `iFirstPoint` and `iLastPoint` values on
    // the full `pathCommands` array.

    let iFirstPoint = 0
    for (const subpath of subpaths) {
      // Get the intersections.
      const internalIntersections = findSelfIntersections(subpath.samplePoints, iFirstPoint)
      allIntersections.push(...internalIntersections)

      // Update offset in global points array.
      iFirstPoint += subpath.samplePoints.length
    }

    // Find intersections between different subpaths.
    for (let i = 0; i < subpaths.length; i++) {
      // 🤮
      // First, get the local (to subpath i) index of the first command that has sample
      // points, then use that to get the index of the first sample point in the
      // global sample points array.
      const iFirstGeomCommandLocalA = subpaths[i].commands.findIndex((x) => x.iFirstPoint !== null)
      const iFirstPointA =
        pathCommands[subpaths[i].iFirstCommand + iFirstGeomCommandLocalA].iFirstPoint

      for (let j = i; j < subpaths.length; j++) {
        if (i == j) {
          continue
        }

        // Similarly, get the local (to subpath k) index of the first command that has sample
        // points, then use that to get the index of the first sample point in the
        // global sample points array.
        const iFirstGeomCommandLocalB = subpaths[j].commands.findIndex(
          (x) => x.iFirstPoint !== null
        )
        const iFirstPointB =
          pathCommands[subpaths[j].iFirstCommand + iFirstGeomCommandLocalB].iFirstPoint

        // Pass those values... they'll be used as offsets for intersection indices,
        // so that the `intersection` object indices are 'global'.
        const intersections = findIntersectionsBetweenSubpaths(
          subpaths[i],
          subpaths[j],
          iFirstPointA!,
          iFirstPointB!
        )
        allIntersections.push(...intersections)
      }
    }

    return allIntersections
  }

  private buildSplitPlan(
    pathCommands: PathCommandEnriched[],
    intersections: Intersection[]
  ): Map<number, number[]> {
    const splitPlan = new Map<number, number[]>()

    // The hard case here is when we have a path composed of two Beziers that
    // 'oscillate' around a straight line. For that case, if the Bezier crosses
    // the line twice, we expect to turn three commands and two intersection points
    // into six fragments.

    // First collect all intersection points for each command.
    for (const intersection of intersections) {
      // Get command indices. Note that the segment is from iPoint to iPoint + 1.
      const iCommandA = this.findCommandIndexForSegment(pathCommands, intersection.iSegmentA)
      const iCommandB = this.findCommandIndexForSegment(pathCommands, intersection.iSegmentB)

      const tA = this.convertSegmentTtoCommandT(
        pathCommands,
        intersection.iSegmentA,
        intersection.tA
      )
      const tB = this.convertSegmentTtoCommandT(
        pathCommands,
        intersection.iSegmentB,
        intersection.tB
      )

      if (tA < 0 || tA > 1 || tB < 0 || tB > 1) {
        throw 'Unexpected t-values found in intersection. This should not happen.'
      }

      if (!splitPlan.has(iCommandA)) splitPlan.set(iCommandA, [])
      if (!splitPlan.has(iCommandB)) splitPlan.set(iCommandB, [])

      splitPlan.get(iCommandA)!.push(tA)
      splitPlan.get(iCommandB)!.push(tB)
    }

    // Sort and deduplicate t-values for each command.
    for (const [cmdIndex, tValues] of splitPlan.entries()) {
      // Sort numerically.
      const uniqueValues = Array.from(new Set(tValues)).sort((a, b) => a - b)

      splitPlan.set(cmdIndex, uniqueValues)
    }

    return splitPlan
  }

  private createPathFragments(
    subpaths: Subpath[],
    pathCommands: PathCommandEnriched[],
    splitPlan: Map<number, number[]>
  ): PathFragment[] {
    const allFragments: PathFragment[] = []

    for (const subpath of subpaths) {
      const subpathFragments = this.createSubpathFragments(subpath, pathCommands, splitPlan)
      allFragments.push(...subpathFragments)
    }

    // Plot fragments one at a time.

    for (const fragment of allFragments) {
      plotter.addPoints([fragment.start, fragment.end], 'lines', 'scatter', 'blue')
      plotter.createPlot()
      let x = 1
    }

    return allFragments
  }

  private createSubpathFragments(
    subpath: Subpath,
    pathCommands: PathCommandEnriched[],
    splitPlan: Map<number, number[]>
  ): PathFragment[] {
    const fragments: PathFragment[] = []

    // Create fragments for commands
    for (let i = subpath.iFirstCommand; i <= subpath.iLastCommand; i++) {
      const cmd = pathCommands[i]
      const tVals = [...(splitPlan.get(i) || []), 0, 1].sort((a, b) => a - b)

      if (Math.min(...tVals) < 0 || Math.max(...tVals) > 1) {
        throw 'Unexpected t-values found in split plan. This should not happen.'
      }

      for (let j = 0; j < tVals.length - 1; j++) {
        const tMin = tVals[j]
        const tMax = tVals[j + 1]

        if (tMax - tMin < EPSILON_INTERSECT) continue

        const fragment = subdivideCommand(cmd, tMin, tMax)
        if (fragment) fragments.push(fragment)
      }
    }

    // Add closing fragment if needed.
    if (fragments.length > 0) {
      const firstPoint = fragments[0].start
      const lastPoint = fragments[fragments.length - 1].end

      if (computePointToPointDistance(firstPoint, lastPoint) > EPSILON_INTERSECT) {
        console.warn('Unexpected open loop detected in subpath. This should not happen.')
        fragments.push(
          new PathFragment({
            type: PathFragmentType.Line,
            start: lastPoint,
            end: firstPoint,
            iCommand: subpath.iLastCommand
          })
        )
      }
    }

    return fragments
  }

  // private createSubpathFragments(
  //   subpath: Subpath,
  //   pathCommands: PathCommandEnriched[],
  //   splitPlan: Map<number, number[]>
  // ): PathFragment[] {
  //   const fragments: PathFragment[] = []

  //   // Create fragments for commands
  //   for (let i = subpath.startIndex; i <= subpath.endIndex; i++) {
  //     const cmd = pathCommands[i]
  //     const tVals = [...(splitPlan.get(i) || []), 0, 1].sort((a, b) => a - b)

  //     for (let j = 0; j < tVals.length - 1; j++) {
  //       const tMin = tVals[j]
  //       const tMax = tVals[j + 1]

  //       if (tMax - tMin < EPSILON_INTERSECT) continue

  //       const fragment = subdivideCommand(cmd, tMin, tMax)
  //       if (fragment) fragments.push(fragment)
  //     }
  //   }

  //   // Add closing fragment if needed.
  //   if (fragments.length > 0) {
  //     const firstPoint = fragments[0].start
  //     const lastPoint = fragments[fragments.length - 1].end

  //     if (computePointToPointDistance(firstPoint, lastPoint) > EPSILON_INTERSECT) {
  //       // TODO: I think we can throw an error here; this should never happen
  //       // since we explicitly close all subpaths early in the process.
  //       fragments.push(
  //         new PathFragment({
  //           type: PathFragmentType.Line,
  //           start: lastPoint,
  //           end: firstPoint,
  //           iCommand: subpath.endIndex
  //         })
  //       )
  //     }
  //   }

  //   return fragments
  // }
}
