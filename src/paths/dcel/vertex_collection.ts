import { newId } from '../../utils/ids'
import { Point } from '../../types/base'
import { HalfEdge, edgeAngle } from './dcel'
import { EPS_INTERSECTION } from '../../intersections/constants'
import { debug } from 'console'
import { SegmentType } from '../path_processor_v2'
import { normalizeAngle } from '../../utils/geometry'
import { EPS_ANGLE_INTERSECTION } from '../../intersections/constants'

export interface Vertex {
  id: string
  x: number
  y: number
  outgoing: HalfEdge[]
}

export class VertexCollection {
  private readonly eps: number
  private readonly scale: number
  private readonly map = new Map<string, Vertex>()

  constructor(eps = EPS_INTERSECTION) {
    this.eps = eps
    this.scale = 1 / eps
  }

  private key(p: Point): string {
    return `X${Math.round(p.x * this.scale)}Y${Math.round(p.y * this.scale)}`
  }

  public getOrCreate(p: Point): Vertex {
    const k = this.key(p)
    let v = this.map.get(k)
    if (!v) {
      v = { id: newId('v'), x: p.x, y: p.y, outgoing: [] }
      this.map.set(k, v)
    }
    return v
  }

  finalizeRotation(): void {
    for (const v of this.map.values()) {
      const outgoing = v.outgoing
      const deg = outgoing.length
      if (deg < 2) continue

      // Build key tuples
      const keyed = outgoing.map((e) => {
        const ang = normalizeAngle(edgeAngle(e))
        const prio =
          {
            [SegmentType.Line]: 0,
            [SegmentType.QuadraticBezier]: 1,
            [SegmentType.CubicBezier]: 2,
            [SegmentType.Arc]: 3
          }[e.geometry.type] ?? 99
        return {
          edge: e,
          angle: ang,
          prio,
          rev: e.geometryReversed ? 1 : 0,
          x: e.head.x,
          y: e.head.y
        }
      })

      // Sort by (angle, prio, rev, x, y)
      keyed.sort((a, b) => {
        const da = a.angle - b.angle
        if (Math.abs(da) > EPS_ANGLE_INTERSECTION) return da
        if (a.prio !== b.prio) return a.prio - b.prio
        if (a.rev !== b.rev) return a.rev - b.rev
        if (a.x !== b.x) return a.x - b.x
        return a.y - b.y
      })

      // Reassign & relink
      v.outgoing = keyed.map((k) => k.edge)
      for (let i = 0; i < deg; ++i) {
        const curr = v.outgoing[i]
        const next = v.outgoing[(i + 1) % deg]
        curr.twin!.next = next
      }
    }
  }

  size(): number {
    return this.map.size
  }
  *vertices(): IterableIterator<Vertex> {
    yield* this.map.values()
  }

  dump(): void {
    // Debug.
    console.table(
      [...this.map.values()].map((v) => ({
        id: v.id,
        x: v.x,
        y: v.y,
        degree: v.outgoing.length
      }))
    )
  }
}

export function debugEdgeAngles(halfEdges: HalfEdge[], vertexCollection: VertexCollection): void {
  console.log('\n=== EDGE ANGLES DEBUG ===')

  // Focus on the problematic vertex (90,50)
  const vertex90_50 = Array.from(vertexCollection.vertices()).find(
    (v) => Math.abs(v.x - 90) < 0.001 && Math.abs(v.y - 50) < 0.001
  )

  if (vertex90_50) {
    console.log(`\nVertex (90,50) has ${vertex90_50.outgoing.length} outgoing edges:`)

    vertex90_50.outgoing.forEach((edge, i) => {
      const angle = edgeAngle(edge)
      const normalizedAngle = normalizeAngle(angle)
      const edgeIdx = halfEdges.indexOf(edge)
      const twinIdx = halfEdges.indexOf(edge.twin!)
      const nextIdx = edge.next ? halfEdges.indexOf(edge.next) : -1

      console.log(
        `  ${i}: Edge[${edgeIdx}] → (${edge.head.x},${edge.head.y}) ` +
          `angle=${((angle * 180) / Math.PI).toFixed(2)}° ` +
          `normalized=${((normalizedAngle * 180) / Math.PI).toFixed(2)}° ` +
          `twin=${twinIdx} next=${nextIdx} ` +
          `geom=${edge.geometry.type} rev=${edge.geometryReversed}`
      )
    })
  }

  // Also check vertex (75,45) which seems to have multiple connections to (90,50)
  const vertex75_45 = Array.from(vertexCollection.vertices()).find(
    (v) => Math.abs(v.x - 75) < 0.001 && Math.abs(v.y - 45) < 0.001
  )

  if (vertex75_45) {
    console.log(`\nVertex (75,45) has ${vertex75_45.outgoing.length} outgoing edges:`)

    vertex75_45.outgoing.forEach((edge, i) => {
      const angle = edgeAngle(edge)
      const normalizedAngle = normalizeAngle(angle)
      const edgeIdx = halfEdges.indexOf(edge)
      const twinIdx = halfEdges.indexOf(edge.twin!)
      const nextIdx = edge.next ? halfEdges.indexOf(edge.next) : -1

      console.log(
        `  ${i}: Edge[${edgeIdx}] → (${edge.head.x},${edge.head.y}) ` +
          `angle=${((angle * 180) / Math.PI).toFixed(2)}° ` +
          `normalized=${((normalizedAngle * 180) / Math.PI).toFixed(2)}° ` +
          `twin=${twinIdx} next=${nextIdx} ` +
          `geom=${edge.geometry.type} rev=${edge.geometryReversed}`
      )
    })
  }
}
