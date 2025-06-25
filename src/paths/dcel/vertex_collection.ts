import { newId } from '../../utils/ids'
import { Point } from '../../types/base'
import { HalfEdge, edgeAngle } from './dcel'
import { EPS_INTERSECTION } from '../../intersections/constants'

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
      // Sort outgoing edges ACW around the vertex and link them.

      const deg = v.outgoing.length
      if (deg < 2) continue

      v.outgoing.sort((eA, eB) => {
        const a = edgeAngle(eA)
        const b = edgeAngle(eB)
        return a - b || 0
      })

      for (let i = 0; i < deg; ++i) {
        const e = v.outgoing[i]
        const eAfter = v.outgoing[(i + 1) % deg]
        e.twin!.next = eAfter
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
