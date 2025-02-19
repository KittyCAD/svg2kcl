import { v4 as uuidv4 } from 'uuid'
import { Point } from '../../types/base'
import { PathFragmentData, PathFragmentType } from '../../types/fragments'

export class PathFragment implements PathFragmentData {
  id: string
  type: PathFragmentType

  // The main points for this geometry:
  start: Point
  end: Point

  // Optionally store additional data for Bézier curves.
  control1?: Point
  control2?: Point

  // Store a link to the original command index in our input path command list.
  iCommand: number

  // Store a list of fragments that are connected to this one.
  connectedFragments?: {
    fragmentId: string
    angle: number
  }[]

  constructor(params: Omit<PathFragmentData, 'id'>) {
    this.id = this.getNextFragmentId()
    this.type = params.type
    this.start = params.start
    this.end = params.end
    this.iCommand = params.iCommand
    this.control1 = params.control1
    this.control2 = params.control2
    this.connectedFragments = params.connectedFragments
  }

  private getNextFragmentId(): string {
    return uuidv4()
  }
}
