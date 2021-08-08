import { Point } from '../types/graphics'

export type TSize = {
  width: number
  height: number
}

export type TRect = {
  x: number
  y: number
  width: number
  height: number
}

/**
 * fields are the same with TRect, but usually x,y is the center of the rect
 */
export type ContentArea = TRect

export function getCenterPoint(rect: TRect) {
  return {
    x: rect.x + rect.width / 2,
    y: rect.y + rect.height / 2,
  }
}

export function getDistance(a: Point, b: Point) {
  return Math.sqrt(Math.pow(b.x - a.x, 2) + Math.pow(b.y - a.y, 2))
}

export function getDistanceSegs(points: Point[]) {
  return points.reduce((out: number[], p, i, arr) => {
    if (arr[i + 1]) {
      const d = getDistance(p, arr[i + 1])
      out.push(d)
    }
    return out
  }, [])
}

export function calcTotalLength(points: Point[]) {
  return getDistanceSegs(points).reduce((out, l) => {
    return out + l
  }, 0)
}

export function interpolateAt(p1: Point, p2: Point, proportion: number): Point {
  const x = p1.x + (p2.x - p1.x) * proportion
  const y = p1.y + (p2.y - p1.y) * proportion
  return { x, y }
}

/**
 * A simple mimic of svg `getPointAtLength()`.
 * Treat all lines between points as straight line.
 */
export function getPointAt(points: Point[], s: number, isProportion = false) {
  if (s <= 0) return
  const segs = getDistanceSegs(points)
  const totalLength = segs.reduce((out, l) => {
    return out + l
  }, 0)
  const len = isProportion ? totalLength * s : s
  let lengthLeft = len
  for (let i = 0; i < segs.length; i++) {
    const segLength = segs[i]
    if (segLength >= lengthLeft) {
      const p1 = points[i]
      const p2 = points[i + 1]
      return interpolateAt(p1, p2, lengthLeft / segLength)
    } else {
      lengthLeft -= segLength
    }
  }
}
