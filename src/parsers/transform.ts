import { Transform, TransformType } from '../types/geometric'
import { Matrix } from '../utils/matrix'

export function parseTransform(transformStr: string | undefined): Transform | undefined {
  if (!transformStr) {
    return undefined
  }

  let matrix = new Matrix()
  const transformRegex = /(translate|scale|rotate|matrix|skewX|skewY)\s*\(([-\d\s,.e]+)\)/g
  let match

  while ((match = transformRegex.exec(transformStr)) !== null) {
    const [, type, valuesStr] = match
    const values = valuesStr.split(/[\s,]+/).map(Number)

    switch (type as TransformType) {
      case TransformType.Translate: {
        const [tx = 0, ty = 0] = values
        matrix = matrix.translate(tx, ty)
        break
      }
      case TransformType.Scale: {
        const [sx = 1, sy = sx] = values
        matrix = matrix.scale(sx, sy)
        break
      }
      case TransformType.Rotate: {
        const [angle = 0, cx = 0, cy = 0] = values
        if (cx || cy) {
          matrix = matrix.translate(cx, cy).rotate(angle).translate(-cx, -cy)
        } else {
          matrix = matrix.rotate(angle)
        }
        break
      }
      case TransformType.SkewX: {
        matrix = matrix.skewX(values[0] || 0)
        break
      }
      case TransformType.SkewY: {
        matrix = matrix.skewY(values[0] || 0)
        break
      }
      case TransformType.Matrix: {
        if (values.length === 6) {
          matrix = matrix.multiply(new Matrix(...values))
        }
        break
      }
    }
  }

  return { matrix }
}
