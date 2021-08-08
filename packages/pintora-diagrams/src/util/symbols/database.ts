import pintora, { safeAssign } from '@pintora/core'
import { makeMark } from '../artist-util'
import { PALETTE } from '../theme'

// a cylinder
pintora.symbolRegistry.register('database', {
  type: 'factory',
  factory({ width, height, x, y }) {
    const rx = width / 2
    const ry = 12
    const halfHeight = height / 2
    const ellipseY = y - halfHeight - ry
    const lineBottomY = y + halfHeight
    const mark = makeMark(
      'group',
      {},
      {
        children: [
          makeMark('path', {
            path: [
              ['M', x - rx, ellipseY], // left top
              ['L', x - rx, lineBottomY], // left bottom
              ['A', rx, ry, 0, 1, 0, x + rx, lineBottomY], // bottom curve
              ['L', x + rx, ellipseY], // right top
            ],
            stroke: PALETTE.normalDark,
          }),
          makeMark('ellipse', {
            x: x,
            y: ellipseY,
            cx: x,
            cy: y,
            rx,
            ry,
            stroke: PALETTE.normalDark,
          }),
        ],
      },
    )
    const sym = makeMark(
      'symbol',
      {},
      {
        mark,
        symbolBounds: {
          left: -rx,
          right: rx,
          top: -(halfHeight + 2 * ry),
          bottom: halfHeight + ry,
          width,
          height: height + ry * 3,
        },
      },
    )
    return sym
  },
  styleMark(mark, def, attrs) {
    mark.children.forEach(child => {
      safeAssign(child.attrs, attrs)
    })
  },
})
