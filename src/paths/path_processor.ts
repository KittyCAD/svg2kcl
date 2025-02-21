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
import { samplePath } from './path'
import { identifyClosedRegions, orderRegions } from './regions'
import { detectAllPlanarFaces } from './half_edge'
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
import path from 'path'
// import { exportPointsToCSV } from '../utils/debug'

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

interface CloseGeometryResult {
  commands: PathCommandEnriched[]
  subpaths: Subpath[]
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

    // Extract fragments.
    const { fragments, fragmentMap } = this.extractFragments(pathCommands, subpaths, intersections)

    // Now walk the fragment chain and resample.
    for (const fragment of fragments) {
      fragment.sampledPoints = sampleFragment(fragment)
    }

    // Use fragments to assemble enclosed regions, compute winding numbers.
    const regions = identifyClosedRegions(fragments, fragmentMap)
    // const regions = detectAllPlanarFaces(fragments, fragmentMap)

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
    const { pathSamplePoints, pathCommands } = samplePath(this.inputCommands)
    const subpaths = this.identifySubpaths(pathCommands, pathSamplePoints)
    const intersections = this.findAllIntersections(subpaths)

    return { pathCommands, subpaths, intersections }
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

  private findCommandIndexForPoint(commands: PathCommandEnriched[], iPoint: number): number {
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
    commands: PathCommandEnriched[],
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

  private identifySubpaths(commands: PathCommandEnriched[], samplePoints: Point[]): Subpath[] {
    const subpaths: Subpath[] = []
    let currentStart = 0
    let currentSampleStart = 0

    for (let i = 0; i < commands.length; i++) {
      const command = commands[i]

      // Check for move commands that start new subpaths
      if (
        i > 0 &&
        (command.type === PathCommandType.MoveAbsolute ||
          command.type === PathCommandType.MoveRelative)
      ) {
        // End previous subpath
        subpaths.push({
          startIndex: currentStart,
          endIndex: i - 1,
          commands: commands.slice(currentStart, i),
          samplePoints: samplePoints.slice(currentSampleStart, command.iFirstPoint)
        })

        currentStart = i
        currentSampleStart = command.iFirstPoint
      }
    }

    // Add final subpath
    if (currentStart < commands.length) {
      subpaths.push({
        startIndex: currentStart,
        endIndex: commands.length - 1,
        commands: commands.slice(currentStart),
        samplePoints: samplePoints.slice(currentSampleStart)
      })
    }

    return subpaths
  }

  private findAllIntersections(subpaths: Subpath[]): Intersection[] {
    const allIntersections: Intersection[] = []

    // TODO: (Maybe) Make these algebraic and not based on sampled points.

    // Find intersections within each subpath
    for (const subpath of subpaths) {
      const internalIntersections = findSelfIntersections(subpath.samplePoints)
      allIntersections.push(...internalIntersections)
    }

    // Find intersections between different subpaths
    for (let i = 0; i < subpaths.length; i++) {
      for (let j = i + 1; j < subpaths.length; j++) {
        const intersections = findIntersectionsBetweenSubpaths(subpaths[i], subpaths[j])
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
      // Get command indices.
      const iCommandA = this.findCommandIndexForPoint(pathCommands, intersection.iSegmentA)
      const iCommandB = this.findCommandIndexForPoint(pathCommands, intersection.iSegmentB)

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

      if (!splitPlan.has(iCommandA)) splitPlan.set(iCommandA, [])
      if (!splitPlan.has(iCommandB)) splitPlan.set(iCommandB, [])

      splitPlan.get(iCommandA)!.push(tA)
      splitPlan.get(iCommandB)!.push(tB)
    }

    // Sort and deduplicate t-values for each command.
    for (const [cmdIndex, tValues] of splitPlan.entries()) {
      // Sort numerically.
      const uniqueValues = Array.from(new Set(tValues)).sort((a, b) => a - b)

      // Ensure we don't have any t-values too close together.
      const filteredValues = uniqueValues.filter((t, i) => {
        if (i === 0) return true
        return Math.abs(t - uniqueValues[i - 1]) > EPSILON_INTERSECT
      })

      splitPlan.set(cmdIndex, filteredValues)
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

    return allFragments
  }

  private createSubpathFragments(
    subpath: Subpath,
    pathCommands: PathCommandEnriched[],
    splitPlan: Map<number, number[]>
  ): PathFragment[] {
    const fragments: PathFragment[] = []

    // Create fragments for commands
    for (let i = subpath.startIndex; i <= subpath.endIndex; i++) {
      const cmd = pathCommands[i]
      const tVals = [...(splitPlan.get(i) || []), 0, 1].sort((a, b) => a - b)

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
        // TODO: I think we can throw an error here; this should never happen
        // since we explicitly close all subpaths early in the process.
        fragments.push(
          new PathFragment({
            type: PathFragmentType.Line,
            start: lastPoint,
            end: firstPoint,
            iCommand: subpath.endIndex
          })
        )
      }
    }

    return fragments
  }
}
