import {
  GraphicsIR,
  IDiagramArtist,
  logger,
  Mark,
  MarkAttrs,
  Rect,
  Group,
  Text,
  Point,
  Line,
  Path,
  safeAssign,
  mat3,
  createMat3,
  createRotateAtPoint,
  leftRotate,
  transform,
  translate,
} from '@pintora/core'
import { db, SequenceDiagramIR, LINETYPE, Message, PLACEMENT, Note, WrappedText } from './db'
import { SequenceConf, defaultConfig, PALETTE } from './config'
import { getBaseNote, drawArrowTo, drawCrossTo, getBaseText, makeMark, makeLoopLabelBox } from './artist-util'

let conf: SequenceConf = {
  ...defaultConfig,
}

type DrawResult<T extends Mark = Mark> = {
  mark: T
}

// message line end
enum LineEndType {
  NONE = 'none',
  ARROWHEAD = 'arrowhead',
  CROSS = 'cross',
}

const sequenceArtist: IDiagramArtist<SequenceDiagramIR> = {
  draw(ir, config?) {
    // conf = configApi.getConfig().sequence
    // db.setWrap(conf.wrap)
    model.init()
    logger.debug(`C:${JSON.stringify(conf, null, 2)}`)

    // Fetch data from the parsing
    const { actors, messages, title } = ir
    const actorKeys = db.getActorKeys()

    const rootMark: Group = {
      type: 'group',
      attrs: {},
      children: [],
    }
    actorKeys.forEach(key => {
      model.actorAttrsMap.set(key, { ...conf.actorStyle })
    })

    const maxMessageWidthPerActor = getMaxMessageWidthPerActor(ir)
    model.maxMessageWidthPerActor = maxMessageWidthPerActor
    conf.actorHeight = calculateActorMargins(actors, maxMessageWidthPerActor)

    const { marks: actorRects } = drawActors(ir, actorKeys, { verticalPos: 0 })
    const loopWidths = calculateLoopBounds(messages, actors)
    rootMark.children.push(...actorRects)

    function activeEnd(msg: Message, verticalPos) {
      const activationData = model.endActivation(msg)
      if (activationData.starty + 18 > verticalPos) {
        activationData.starty = verticalPos - 6
        verticalPos += 12
      }
      drawActivationTo(rootMark, activationData)

      model.insert(activationData.startx, verticalPos - 10, activationData.stopx, verticalPos)
    }

    // Draw the messages/signals
    let sequenceIndex = 1
    messages.forEach(function (msg) {
      let loopModel, noteModel, msgModel

      switch (msg.type) {
        case LINETYPE.NOTE:
          noteModel = model.noteModelMap.get(msg.id)
          drawNoteTo(noteModel, rootMark)
          break
        case LINETYPE.ACTIVE_START:
          model.newActivation(msg)
          break
        case LINETYPE.ACTIVE_END:
          activeEnd(msg, model.verticalPos)
          break
        // case LINETYPE.LOOP_START:
        //   adjustLoopHeightForWrap(loopWidths, msg, conf.boxMargin, conf.boxMargin + conf.boxTextMargin, message =>
        //     model.newLoop(message),
        //   )
        //   break
        // case LINETYPE.LOOP_END:
        //   loopModel = model.endLoop()
        //   svgDraw.drawLoop(diagram, loopModel, 'loop', conf)
        //   model.bumpVerticalPos(loopModel.stopy - model.verticalPos)
        //   model.models.addLoop(loopModel)
        //   break
        // case LINETYPE.RECT_START:
        //   adjustLoopHeightForWrap(loopWidths, msg, conf.boxMargin, conf.boxMargin, message =>
        //     model.newLoop(undefined, message.message),
        //   )
        //   break
        // case LINETYPE.RECT_END:
        //   loopModel = model.endLoop()
        //   svgDraw.drawBackgroundRect(diagram, loopModel)
        //   model.models.addLoop(loopModel)
        //   model.bumpVerticalPos(loopModel.stopy - model.getVerticalPos())
        //   break
        case LINETYPE.OPT_START:
          adjustLoopHeightForWrap(loopWidths, msg, conf.boxMargin, conf.boxMargin + conf.boxTextMargin, ({message, width}) =>
            model.newLoop(message, width)
          )
          break
        case LINETYPE.OPT_END:
          loopModel = model.endLoop()
          drawLoopTo(rootMark, loopModel, 'opt', conf)
          model.bumpVerticalPos(loopModel.stopy - model.verticalPos)
          model.loops.push(loopModel)
          break
        case LINETYPE.ALT_START:
          adjustLoopHeightForWrap(
            loopWidths,
            msg,
            conf.boxMargin,
            conf.boxMargin + conf.boxTextMargin,
            ({ message, width }) => model.newLoop(message, width),
          )
          break
        case LINETYPE.ALT_ELSE:
          adjustLoopHeightForWrap(
            loopWidths,
            msg,
            conf.boxMargin + conf.boxTextMargin,
            conf.boxMargin,
            ({ message, width }) => model.addSectionToLoop(message, width),
          )
          break
        case LINETYPE.ALT_END:
          loopModel = model.endLoop()
          drawLoopTo(rootMark, loopModel, 'alt', conf)
          model.bumpVerticalPos(loopModel.stopy - model.verticalPos)
          model.loops.push(loopModel)
          break
        case LINETYPE.PAR_START:
          adjustLoopHeightForWrap(loopWidths, msg, conf.boxMargin, conf.boxMargin + conf.boxTextMargin, ({message, width}) =>
            model.newLoop(message, width)
          )
          break
        case LINETYPE.PAR_AND:
          adjustLoopHeightForWrap(loopWidths, msg, conf.boxMargin + conf.boxTextMargin, conf.boxMargin, ({message, width}) =>
            model.addSectionToLoop(message, width)
          )
          break
        case LINETYPE.PAR_END:
          loopModel = model.endLoop()
          drawLoopTo(rootMark, loopModel, 'par', conf)
          model.bumpVerticalPos(loopModel.stopy - model.verticalPos)
          model.loops.push(loopModel)
          break
        default:
          try {
            msgModel = model.msgModelMap.get(msg.id) // FI
            if (!msgModel) {
              console.warn('no msgModel for', msg)
              return
            }
            msgModel.starty = model.verticalPos
            // console.log('msgModel starty', msgModel, model.verticalPos)
            msgModel.sequenceIndex = sequenceIndex
            rootMark.children.push(drawMessage(ir, msgModel).mark)
            model.messageMarks.push(msgModel)
          } catch (e) {
            logger.error('error while drawing message', e)
          }
      }
      // Increment sequence counter if msg.type is a line (and not another event like activation or note, etc)
      if (
        [
          LINETYPE.SOLID_OPEN,
          LINETYPE.DOTTED_OPEN,
          LINETYPE.SOLID,
          LINETYPE.DOTTED,
          LINETYPE.SOLID_CROSS,
          LINETYPE.DOTTED_CROSS,
          LINETYPE.SOLID_POINT,
          LINETYPE.DOTTED_POINT,
        ].includes(msg.type)
      ) {
        sequenceIndex++
      }
    })

    if (conf.mirrorActors) {
      // Draw actors below diagram
      model.bumpVerticalPos(conf.boxMargin * 2)
      const { marks: mirrorActorRects } = drawActors(ir, actorKeys, { verticalPos: model.verticalPos, isMirror: true })
      rootMark.children.push(...mirrorActorRects)
    }

    const box = model.getBounds()

    let height = box.stopy - box.starty + 2 * conf.diagramMarginY
    if (conf.mirrorActors) {
      height = height - conf.boxMargin + conf.diagramMarginY
    }

    const width = box.stopx - box.startx + 2 * conf.diagramMarginX

    if (title) {
      rootMark.children.push({
        type: 'text',
        attrs: {
          text: title,
          x: (box.stopx - box.startx) / 2,
          y: 0,
          // x: (box.stopx - box.startx) / 2 - 2 * conf.diagramMarginX,
          // y: -25,
        },
      })
    }

    rootMark.matrix = mat3.fromTranslation(mat3.create(), [conf.diagramMarginX, conf.diagramMarginY])
    // const extraVertForTitle = title ? 40 : 0
    // diagram.attr(
    //   'viewBox',
    //   box.startx -
    //     conf.diagramMarginX +
    //     ' -' +
    //     (conf.diagramMarginY + extraVertForTitle) +
    //     ' ' +
    //     width +
    //     ' ' +
    //     (height + extraVertForTitle),
    // )
    // logger.debug(`bounds models:`, model.models)

    const graphicsIR: GraphicsIR = {
      mark: rootMark,
      width,
      height,
    }

    return graphicsIR
  },
}

type ActivationData = {
  startx: number
  starty: number
  stopx: number
  stopy: number
  actor: string
}

type LoopModel = {
  startx: number
  stopx: number
  starty: number
  stopy: number
  width: number
  height: number
  title: string
  wrap?: boolean
  sections?: any[]
  sectionTitles?: any[]
}

class Model {
  sequenceItems: LoopModel[]
  activations: ActivationData[] = []
  data: {
    startx: number
    stopx: number
    starty: number
    stopy: number
  }
  verticalPos: number
  actorAttrsMap = new Map<string, MarkAttrs>()
  msgModelMap = new Map<string, MessageModel>()
  actorLineMarkMap = new Map<string, Line>()
  messageMarks: Text[]
  maxMessageWidthPerActor: { [key: string]: number } = {}
  noteModelMap = new Map<string, MessageModel>()
  loops: LoopModel[]

  init() {
    this.sequenceItems = []
    this.messageMarks = []
    this.clear()
    this.data = {
      startx: undefined,
      stopx: undefined,
      starty: undefined,
      stopy: undefined,
    }
    this.verticalPos = 0
    this.loops = []
    // setConf(db.getConfig())
  }
  clear() {
    this.activations = []
    this.actorAttrsMap.clear()
    this.actorLineMarkMap.clear()
    this.msgModelMap.clear()
    this.messageMarks = []
    this.maxMessageWidthPerActor = {}
    this.noteModelMap.clear()
  }
  updateVal(obj, key, val, fun) {
    if (typeof obj[key] === 'undefined') {
      obj[key] = val
    } else {
      obj[key] = fun(val, obj[key])
    }
  }
  updateBounds(startx, starty, stopx, stopy) {
    const _self = this
    let cnt = 0
    function updateFn(type?) {
      return function updateItemBounds(item) {
        cnt++
        // The loop sequenceItems is a stack so the biggest margins in the beginning of the sequenceItems
        const n = _self.sequenceItems.length - cnt + 1

        _self.updateVal(item, 'starty', starty - n * conf.boxMargin, Math.min)
        _self.updateVal(item, 'stopy', stopy + n * conf.boxMargin, Math.max)

        _self.updateVal(_self.data, 'startx', startx - n * conf.boxMargin, Math.min)
        _self.updateVal(_self.data, 'stopx', stopx + n * conf.boxMargin, Math.max)

        if (!(type === 'activation')) {
          _self.updateVal(item, 'startx', startx - n * conf.boxMargin, Math.min)
          _self.updateVal(item, 'stopx', stopx + n * conf.boxMargin, Math.max)

          _self.updateVal(_self.data, 'starty', starty - n * conf.boxMargin, Math.min)
          _self.updateVal(_self.data, 'stopy', stopy + n * conf.boxMargin, Math.max)
        }
      }
    }

    this.sequenceItems.forEach(updateFn())
    this.activations.forEach(updateFn('activation'))
  }
  insert(startx: number, starty: number, stopx: number, stopy) {
    const _startx = Math.min(startx, stopx)
    const _stopx = Math.max(startx, stopx)
    const _starty = Math.min(starty, stopy)
    const _stopy = Math.max(starty, stopy)

    // const hasUndefined = [startx, starty, stopx, stopy].some(v => v == undefined)
    // if (hasUndefined) {
    //   console.warn('has undefined', arguments)
    //   // debugger
    // }

    this.updateVal(this.data, 'startx', _startx, Math.min)
    this.updateVal(this.data, 'starty', _starty, Math.min)
    this.updateVal(this.data, 'stopx', _stopx, Math.max)
    this.updateVal(this.data, 'stopy', _stopy, Math.max)

    this.updateBounds(_startx, _starty, _stopx, _stopy)
  }
  newActivation(message: Message) {
    const actorRect = this.actorAttrsMap.get(message.from)
    const stackedSize = actorActivations(message.from).length || 0
    const x = actorRect.x + actorRect.width / 2 + ((stackedSize - 1) * conf.activationWidth) / 2
    this.activations.push({
      startx: x,
      starty: this.verticalPos + 2,
      stopx: x + conf.activationWidth,
      stopy: undefined,
      actor: message.from,
      // anchored: svgDraw.anchorElement(diagram),
    })
  }
  endActivation(message: Message) {
    // find most recent activation for given actor
    const lastActorActivationIdx = this.activations
      .map(activation => {
        return activation.actor
      })
      .lastIndexOf(message.from)
    return this.activations.splice(lastActorActivationIdx, 1)[0]
  }
  createLoop(title: WrappedText = { text: undefined, wrap: false }, width: number, fill?) {
    return {
      startx: undefined,
      starty: this.verticalPos,
      stopx: undefined,
      stopy: undefined,
      title: title.text,
      wrap: title.wrap,
      width,
      height: 0,
      fill: fill,
    }
  }
  newLoop(title: WrappedText = { text: undefined, wrap: false }, width: number, fill?) {
    this.sequenceItems.push(this.createLoop(title, width, fill))
  }
  endLoop() {
    return this.sequenceItems.pop()
  }
  addSectionToLoop(message: Message, width: number) {
    const loop = this.sequenceItems.pop()
    loop.sections = loop.sections || []
    loop.sectionTitles = loop.sectionTitles || []
    loop.sections.push({ y: this.verticalPos, width, height: 0 })
    loop.sectionTitles.push(message)
    this.sequenceItems.push(loop)
  }
  bumpVerticalPos(bump) {
    this.verticalPos = this.verticalPos + bump
    this.data.stopy = this.verticalPos
  }
  getBounds() {
    return this.data
  }

  getHeight() {
    const actorHeight =
      this.actorAttrsMap.size === 0
        ? 0
        : Array.from(this.actorAttrsMap.values()).reduce((acc, actor) => {
            return Math.max(acc, actor.height || 0)
          }, 0)
    const messagesHeight = this.msgModelMap.size
      ? Array.from(this.msgModelMap.values()).reduce((acc, h) => acc + h.height, 0)
      : 0
    const notesHeight = this.noteModelMap.size
      ? Array.from(this.noteModelMap.values()).reduce((acc, h) => acc + h.height, 0)
      : 0

    const loopsHeight = this.loops.reduce((acc, h) => acc + h.height, 0)
    return actorHeight + messagesHeight + notesHeight + loopsHeight
  }
}

const model = new Model()

const actorActivations = function (actor: string) {
  return model.activations.filter(function (activation) {
    return activation.actor === actor
  })
}

const activationBounds = function (actor: string) {
  // handle multiple stacked activations for same actor
  const actorAttrs = model.actorAttrsMap.get(actor)
  const activations = actorActivations(actor)

  const left = activations.reduce(function (acc, activation) {
    return Math.min(acc, activation.startx)
  }, actorAttrs.x + actorAttrs.width / 2)
  const right = activations.reduce(function (acc, activation) {
    return Math.max(acc, activation.stopx)
  }, actorAttrs.x + actorAttrs.width / 2)
  return [left, right]
}

function adjustLoopHeightForWrap(
  loopWidths,
  msg: Message,
  preMargin,
  postMargin,
  addLoopFn: ({ message, width }) => void,
) {
  model.bumpVerticalPos(preMargin)
  let heightAdjust = postMargin
  let loopWidth = 0
  if (msg.id && msg.text && loopWidths[msg.id]) {
    loopWidth = loopWidths[msg.id].width
    let textConf = messageFont(conf)
    // msg.message = utils.wrapLabel(`[${msg.message}]`, loopWidth - 2 * conf.wrapPadding, textConf);
    msg.text = `[${msg.text}]`
    msg.wrap = true

    // const lines = common.splitBreaks(msg.message).length;
    const textDims = utils.calculateTextDimensions(msg.text, textConf)
    const totalOffset = Math.max(textDims.height, conf.labelBoxHeight)
    heightAdjust = postMargin + totalOffset
    logger.debug(`yOffset: ${totalOffset} - ${msg.text}`)
  }
  addLoopFn({ message: msg, width: loopWidth })
  model.bumpVerticalPos(heightAdjust)
}

interface IFont {
  fontFamily: string
  fontSize: number
  fontWeight: number | string
}

const CHARACTERS = '0123456789abcdef'
function makeid(length: number) {
  let result = ''
  let CHARACTERSLength = CHARACTERS.length
  for (let i = 0; i < length; i++) {
    result += CHARACTERS.charAt(Math.floor(Math.random() * CHARACTERSLength))
  }
  return result
}

// TODO: this should be implemented in the core package, here is just a simple mock
const utils = {
  makeid,
  calculateTextDimensions(text: string, font: IFont) {
    const lines = text.split('\n')
    let width = 0
    let height = 0
    lines.forEach((line, i) => {
      const w = line.length * 14
      width = Math.max(w, width)
      height += 14 + (i === 0 ? 0 : 8)
    })
    // console.log('calculateTextDimensions', text, width, height)
    return {
      width,
      height,
    }
  },
}

const messageFont = (cnf: SequenceConf) => {
  return {
    fontFamily: cnf.messageFontFamily,
    fontSize: cnf.messageFontSize,
    fontWeight: cnf.messageFontWeight,
  }
}

// TODO: this should be implemented by style config
const actorFont = messageFont
const noteFont = messageFont

function splitBreaks(text) {
  return text.split('\n')
}

/**
 * Draws a message
 */
const drawMessage = function (ir: SequenceDiagramIR, msgModel: MessageModel): DrawResult<Group> {
  model.bumpVerticalPos(conf.boxMargin)
  const { startx, stopx, starty, text, fromBound, type, sequenceIndex } = msgModel
  const linesCount = splitBreaks(text).length
  const textDims = utils.calculateTextDimensions(text, messageFont(conf))
  // const textWidth = textDims.width
  const lineHeight = textDims.height / linesCount

  model.bumpVerticalPos(lineHeight)
  const tAttrs: Text['attrs'] = {
    text: '',
    textAlign: 'center',
    textBaseline: 'top',
    fill: conf.messageTextColor,
    stroke: conf.messageTextColor,
  }

  // console.log('drawMessage', msgModel.text, msgModel.width)

  // center the text in message container
  tAttrs.x = fromBound + msgModel.width / 2
  tAttrs.y = starty + conf.boxMargin
  tAttrs.width = msgModel.width
  tAttrs.text = text
  tAttrs.fontFamily = conf.messageFontFamily
  tAttrs.fontSize = conf.messageFontSize
  tAttrs.fontWeight = conf.messageFontWeight
  // tAttrs.textMargin = conf.wrapPadding

  let totalOffset = textDims.height
  let lineStarty
  const lineAttrs: Partial<Line['attrs']> = {
    stroke: conf.messageTextColor,
    lineWidth: 2,
  }
  const { verticalPos } = model
  // TODO: Draw the line
  if (startx === stopx) {
    // TODO: draw path
    lineStarty = model.verticalPos + totalOffset
    totalOffset += conf.boxMargin

    lineStarty = model.verticalPos + totalOffset
    safeAssign(lineAttrs, {
      x1: startx,
      x2: startx + 60,
      y1: lineStarty,
      y2: lineStarty + 20,
    })

    // line = g
    //   .append('path')
    //   .attr(
    //     'd',
    //     'M ' +
    //       startx +
    //       ',' +
    //       lineStarty +
    //       ' C ' +
    //       (startx + 60) +
    //       ',' +
    //       (lineStarty - 10) +
    //       ' ' +
    //       (startx + 60) +
    //       ',' +
    //       (lineStarty + 30) +
    //       ' ' +
    //       startx +
    //       ',' +
    //       (lineStarty + 20),
    //   )

    // totalOffset += 30
    // const dx = Math.max(textWidth / 2, conf.actorWidth / 2)
    // model.insert(startx - dx, verticalPos - 10 + totalOffset, stopx + dx, verticalPos + 30 + totalOffset)
  } else {
    // totalOffset += conf.boxMrgin
    lineStarty = verticalPos + totalOffset
    safeAssign(lineAttrs, {
      x1: startx,
      x2: stopx,
      y1: lineStarty,
      y2: lineStarty,
    })
    model.insert(startx, lineStarty - 10, stopx, lineStarty)
  }

  // line type
  if (
    type === LINETYPE.DOTTED ||
    type === LINETYPE.DOTTED_CROSS ||
    type === LINETYPE.DOTTED_POINT ||
    type === LINETYPE.DOTTED_OPEN
  ) {
    safeAssign(lineAttrs, {
      lineDash: [3, 3],
    })
  }

  const isRightArrow = stopx > startx
  const arrowRad = isRightArrow ? 0 : -Math.PI
  let lineEndMark: Path = null

  let lineEndType: LineEndType = LineEndType.NONE

  if (type === LINETYPE.SOLID || type === LINETYPE.DOTTED) {
    lineEndType = LineEndType.ARROWHEAD
    lineEndMark = drawArrowTo({ x: lineAttrs.x2, y: lineAttrs.y2 }, 10, arrowRad, {
      fill: lineAttrs.stroke,
    })
  }
  if (type === LINETYPE.SOLID_POINT || type === LINETYPE.DOTTED_POINT) {
    lineEndType = LineEndType.NONE
  }

  if (type === LINETYPE.SOLID_CROSS || type === LINETYPE.DOTTED_CROSS) {
    lineEndType = LineEndType.CROSS
    const crossOffset = 5
    const crossCenterX = lineAttrs.x2 + crossOffset * (isRightArrow ?  -1: 1)
    lineEndMark = drawCrossTo({ x: crossCenterX, y: lineAttrs.y2 }, 10, arrowRad, {
      stroke: lineAttrs.stroke,
      lineWidth: 2,
    })
    if (isRightArrow) {
      lineAttrs.x2 -= crossOffset
    } else {
      lineAttrs.x2 += crossOffset
    }
  }

  let numberMark: Group
  // add node number
  if (db.showSequenceNumbers || conf.showSequenceNumbers) {
    const numberTextMark = makeMark('text', {
      ...getBaseText(),
      text: sequenceIndex.toString(),
      x: startx,
      y: lineStarty,
      textAlign: 'center',
      textBaseline: 'middle',
      fill: '#fff',
    }, { class: 'sequence-number' })
    const circleMark = makeMark('marker', {
      symbol: 'circle',
      x: startx,
      y: lineStarty,
      r: 8,
      fill: PALETTE.normalDark,
      stroke: PALETTE.normalDark,
    })
    numberMark = makeMark('group', {}, {
      children: [circleMark, numberTextMark]
    })
  }
  // console.log('bumpVerticalPos , totalOffset', totalOffset)
  model.bumpVerticalPos(totalOffset)
  msgModel.height += totalOffset
  msgModel.stopy = msgModel.starty + msgModel.height
  model.insert(msgModel.fromBound, msgModel.starty, msgModel.toBound, msgModel.stopy)
  // model.insert(msgModel.startx, msgModel.starty, msgModel.stopx, msgModel.stopy)

  return {
    mark: {
      type: 'group',
      class: 'message',
      children: [
        {
          type: 'line',
          attrs: lineAttrs,
          class: 'message__line',
        },
        lineEndMark,
        {
          type: 'text',
          attrs: tAttrs,
          class: 'message__text'
        },
        numberMark,
      ].filter(o => Boolean(o)) as Mark[],
    },
  }
}

/**
 * Draws an note in the diagram with the attached line
 * @param elem - The diagram to draw to.
 * @param noteModel:{x: number, y: number, message: string, width: number} - startx: x axis start position, verticalPos: y axis position, messsage: the message to be shown, width: Set this with a custom width to override the default configured width.
 */
const drawNoteTo = function (noteModel: NoteModel, container: Group) {
  model.bumpVerticalPos(conf.boxMargin)

  const textDims = utils.calculateTextDimensions(noteModel.text, noteFont(conf))
  const textHeight = textDims.height
  noteModel.height = textHeight + 2 * conf.noteMargin
  noteModel.starty = model.verticalPos
  const rectAttrs = getBaseNote()
  safeAssign(rectAttrs, {
    x: noteModel.startx,
    y: noteModel.starty,
    width: noteModel.width || conf.noteWidth,
    height: noteModel.height,
  })
  const noteRect: Rect = {
    type: 'rect',
    class: 'note__bg',
    attrs: rectAttrs,
  }

  const textAttrs: Text['attrs'] = { fill: conf.actorTextColor, text: noteModel.text, ...(noteFont(conf) as any) }
  safeAssign(textAttrs, {
    x: noteModel.startx + noteModel.width / 2,
    y: noteModel.starty + noteModel.height / 2,
    width: noteModel.width,
    textAlign: 'center',
    textBaseline: 'middle',
  })

  const textMark: Text = {
    type: 'text',
    attrs: textAttrs,
  }

  model.bumpVerticalPos(textHeight + 2 * conf.noteMargin)
  noteModel.stopy = noteModel.starty + textHeight + 2 * conf.noteMargin
  noteModel.stopx = noteModel.startx + rectAttrs.width
  model.insert(noteModel.startx, noteModel.starty, noteModel.stopx, noteModel.stopy)
  const mark: Group = {
    type: 'group',
    class: 'note',
    children: [noteRect, textMark],
  }
  container.children.push(mark)
}

type DrawActorsOptions = {
  verticalPos?: number
  isMirror?: boolean
}

export const drawActors = function (
  ir: SequenceDiagramIR,
  actorKeys: string[],
  opts: DrawActorsOptions,
): { marks: Mark[] } {
  // console.log('drawActors', verticalPos)
  // Draw the actors
  let prevWidth = 0
  let prevMargin = 0
  const { verticalPos = 0, isMirror } = opts

  const marks: Group[] = []

  for (let i = 0; i < actorKeys.length; i++) {
    const key = actorKeys[i]
    const actor = ir.actors[key]
    const attrsKey = isMirror ? `${key}_mirror` : key

    let attrs: MarkAttrs
    if (isMirror) {
      attrs = { ...model.actorAttrsMap.get(key) }
    } else {
      attrs = model.actorAttrsMap.get(key) || { ...conf.actorStyle }
    }
    const textAttrs: Text['attrs'] = { fill: conf.actorTextColor, text: actor.name, ...(actorFont(conf) as any) }

    // Add some rendering data to the object
    safeAssign(attrs, {
      width: attrs.width || conf.actorWidth,
      height: Math.max(attrs.height || 0, conf.actorHeight),
      margin: attrs.margin || conf.actorMargin,
      x: prevWidth + prevMargin,
      y: verticalPos,
      radius: 4,
    })
    // console.log('drawActors', attrsKey, verticalPos, 'attrs', attrs)

    const actorCenter: Point = { x: attrs.x + attrs.width / 2, y: attrs.y + attrs.height / 2 }
    safeAssign(textAttrs, {
      x: actorCenter.x,
      y: actorCenter.y,
      textAlign: 'center',
      textBaseline: 'middle',
    })

    // Draw the attached line
    let lineMark: Line
    if (!isMirror) {
      lineMark = {
        type: 'line',
        class: 'actor__line',
        attrs: {
          x1: actorCenter.x,
          x2: actorCenter.x,
          y1: attrs.y,
          y2: 2000,
          stroke: PALETTE.normalDark,
        },
      }
      model.actorLineMarkMap.set(key, lineMark)
    } else {
      const prevLineMark = model.actorLineMarkMap.get(key)
      if (prevLineMark) {
        prevLineMark.attrs.y2 = attrs.y
      }
    }

    model.insert(attrs.x, verticalPos, attrs.x + attrs.width, attrs.height)

    prevWidth += attrs.width
    prevMargin += attrs.margin

    const actorMark: Group = {
      type: 'group',
      class: 'actor',
      children: [
        {
          type: 'rect',
          attrs: attrs,
        },
        {
          type: 'text',
          attrs: textAttrs,
        },
      ],
    }
    if (lineMark) {
      actorMark.children.unshift(lineMark)
    }

    // console.log('actorMark', attrsKey, actorMark)

    marks.push(actorMark)
    model.actorAttrsMap.set(attrsKey, attrs)
  }

  // Add a margin between the actor boxes and the first arrow
  model.bumpVerticalPos(conf.actorHeight)

  return { marks }
}

function drawActivationTo(mark: Group, data: ActivationData) {
  const rectAttrs = getBaseNote()
  safeAssign(rectAttrs, {
    x: data.startx,
    y: data.starty,
    width: data.stopx - data.startx,
    height: model.verticalPos - data.starty,
    fill: PALETTE.neutralGray,
  })
  const rect: Rect = {
    type: 'rect',
    class: 'activation',
    attrs: rectAttrs,
  }
  mark.children.push(rect)
}

function drawLoopTo(mark: Group, loopModel: LoopModel, labelText: string, conf: SequenceConf) {
  // console.log('draw loop', labelText, loopModel)
  const loopLineColor = PALETTE.purple
  const group = makeMark('group', {}, { children: [], class: 'loop' })
  function drawLoopLine(startx: number, starty: number, stopx: number, stopy: number) {
    const line = makeMark(
      'line',
      {
        x1: startx,
        x2: stopx,
        y1: starty,
        y2: stopy,
        stroke: loopLineColor,
        lineWidth: 2,
        lineDash: [2, 2],
      },
      { class: 'loopline' },
    )
    group.children.push(line)
  }
  const { startx, starty, stopx, stopy } = loopModel
  drawLoopLine(startx, starty, stopx, starty)
  drawLoopLine(stopx, starty, stopx, stopy)
  drawLoopLine(startx, stopy, stopx, stopy)
  drawLoopLine(startx, starty, startx, stopy)
  if (loopModel.sections) {
    loopModel.sections.forEach(function(item) {
      drawLoopLine(startx, item.y, loopModel.stopx, item.y)
    });
  }

  const {
    boxMargin,
    boxTextMargin,
    labelBoxWidth,
    labelBoxHeight,
    messageFontFamily: fontFamily,
    messageFontSize: fontSize,
    messageFontWeight: fontWeight,
    messageTextColor: textColor,
  } = conf

  const tAttrs = getBaseText()
  safeAssign(tAttrs, {
    text: labelText,
    x: startx + boxTextMargin,
    y: starty + boxTextMargin,
    textBaseline: 'top',
    fontFamily,
    fontSize,
    fontWeight,
    fill: textColor,
  })
  const labelTextMark = makeMark('text', tAttrs, { class: 'label-text' })

  const labelTextSize = utils.calculateTextDimensions(labelText, messageFont(conf))
  const labelWidth = Math.max(labelTextSize.width + 2 * boxTextMargin, labelBoxWidth
    )
  const labelHeight = Math.max(labelTextSize.height + 2 * boxTextMargin, labelBoxHeight)

  const labelWrap = makeLoopLabelBox({ x: startx, y: starty }, labelWidth, labelHeight, 5)
  safeAssign(labelWrap.attrs, {
    fill: conf.actorStyle.fill,
    stroke: loopLineColor,
  })

  const loopWidth = stopx - startx

  const titleMark = makeMark('text', {
    text: loopModel.title,
    x: startx + loopWidth / 2 + labelBoxWidth / 2,
    y: starty + boxTextMargin,
    textBaseline: 'top',
    textAlign: 'center',
    fontFamily,
    fontSize,
    fontWeight,
    fill: textColor,
  }, { class: 'loop__title' })
  group.children.push(labelWrap, labelTextMark, titleMark)

  if (loopModel.sectionTitles) {
    loopModel.sectionTitles.forEach(function(item, idx) {
      if (item.text) {
        const sectionTitleMark = makeMark('text', {
          ...getBaseText(),
          text: item.text,
          x: startx + loopWidth / 2,
          y: loopModel.sections[idx].y + boxTextMargin,
          textAlign: 'center',
          textBaseline: 'top',
          fontFamily,
          fontSize,
          fontWeight,
          fill: conf.messageTextColor,
        }, { class: 'loop__title' })
        let { height: sectionHeight } = utils.calculateTextDimensions(item.text, messageFont(conf))
        loopModel.sections[idx].height += sectionHeight - (boxMargin + boxTextMargin);
        group.children.push(sectionTitleMark)
      }
    });
  }

  mark.children.push(group)
}

/**
 * Retrieves the max message width of each actor, supports signals (messages, loops)
 * and notes.
 *
 * It will enumerate each given message, and will determine its text width, in relation
 * to the actor it originates from, and destined to.
 */
const getMaxMessageWidthPerActor = function (ir: SequenceDiagramIR) {
  const { actors, messages } = ir
  const maxMessageWidthPerActor = {}

  messages.forEach(function (msg) {
    if (actors[msg.to] && actors[msg.from]) {
      const actor = actors[msg.to]
      const { prevActorId, nextActorId } = actor

      // If this is the first actor, and the message is left of it, no need to calculate the margin
      if (msg.placement === PLACEMENT.LEFTOF && !prevActorId) {
        return
      }

      // If this is the last actor, and the message is right of it, no need to calculate the margin
      if (msg.placement === PLACEMENT.RIGHTOF && !actor.nextActorId) {
        return
      }

      const isNote = msg.placement !== undefined
      const isMessage = !isNote

      const textFont = isNote ? noteFont(conf) : messageFont(conf)
      const wrappedMessage = msg.text
      // TODO: wrap
      // let wrappedMessage = msg.wrap
      //   ? utils.wrapLabel(msg.message, conf.width - 2 * conf.wrapPadding, textFont)
      //   : msg.message;
      const messageDimensions = utils.calculateTextDimensions(wrappedMessage, textFont)
      const messageWidth = messageDimensions.width + 2 * conf.wrapPadding

      /*
       * The following scenarios should be supported:
       *
       * - There's a message (non-note) between fromActor and toActor
       *   - If fromActor is on the right and toActor is on the left, we should
       *     define the toActor's margin
       *   - If fromActor is on the left and toActor is on the right, we should
       *     define the fromActor's margin
       * - There's a note, in which case fromActor == toActor
       *   - If the note is to the left of the actor, we should define the previous actor
       *     margin
       *   - If the note is on the actor, we should define both the previous and next actor
       *     margins, each being the half of the note size
       *   - If the note is on the right of the actor, we should define the current actor
       *     margin
       */
      if (isMessage && msg.from === nextActorId) {
        maxMessageWidthPerActor[msg.to] = Math.max(maxMessageWidthPerActor[msg.to] || 0, messageWidth)
      } else if (isMessage && msg.from === prevActorId) {
        maxMessageWidthPerActor[msg.from] = Math.max(maxMessageWidthPerActor[msg.from] || 0, messageWidth)
      } else if (isMessage && msg.from === msg.to) {
        maxMessageWidthPerActor[msg.from] = Math.max(maxMessageWidthPerActor[msg.from] || 0, messageWidth / 2)

        maxMessageWidthPerActor[msg.to] = Math.max(maxMessageWidthPerActor[msg.to] || 0, messageWidth / 2)
      } else if (msg.placement === PLACEMENT.RIGHTOF) {
        maxMessageWidthPerActor[msg.from] = Math.max(maxMessageWidthPerActor[msg.from] || 0, messageWidth)
      } else if (msg.placement === PLACEMENT.LEFTOF) {
        maxMessageWidthPerActor[prevActorId] = Math.max(maxMessageWidthPerActor[prevActorId] || 0, messageWidth)
      } else if (msg.placement === PLACEMENT.OVER) {
        if (prevActorId) {
          maxMessageWidthPerActor[prevActorId] = Math.max(maxMessageWidthPerActor[prevActorId] || 0, messageWidth / 2)
        }

        if (nextActorId) {
          maxMessageWidthPerActor[msg.from] = Math.max(maxMessageWidthPerActor[msg.from] || 0, messageWidth / 2)
        }
      }
    }
  })

  // logger.debug('maxMessageWidthPerActor:', maxMessageWidthPerActor)
  return maxMessageWidthPerActor
}

/**
 * This will calculate the optimal margin for each given actor, for a given
 * actor->messageWidth map.
 *
 * An actor's margin is determined by the width of the actor, the width of the
 * largest message that originates from it, and the configured conf.actorMargin.
 *
 * @param actors - The actors map to calculate margins for
 * @param actorToMessageWidth - A map of actor key -> max message width it holds
 */
const calculateActorMargins = function (actors: SequenceDiagramIR['actors'], actorToMessageWidth) {
  let maxHeight = 0
  Object.keys(actors).forEach(prop => {
    const actorAttrs = model.actorAttrsMap.get(prop)
    const actor = actors[prop]
    // if (actor.wrap) {
    //   actor.description = utils.wrapLabel(
    //     actor.description,
    //     conf.width - 2 * conf.wrapPadding,
    //     actorFont(conf)
    //   );
    // }
    const actDims = utils.calculateTextDimensions(actor.description, actorFont(conf))
    actorAttrs.width = actor.wrap ? conf.actorHeight : Math.max(conf.actorWidth, actDims.width + 2 * conf.wrapPadding)

    actorAttrs.height = actor.wrap ? Math.max(actDims.height, conf.actorHeight) : conf.actorHeight
    maxHeight = Math.max(maxHeight, actorAttrs.height)
  })

  for (let actorKey in actorToMessageWidth) {
    const actor = actors[actorKey]
    const actorAttrs = model.actorAttrsMap.get(actorKey)

    if (!actor) {
      continue
    }

    const nextActorAttrs = model.actorAttrsMap.get(actor.nextActorId)

    // No need to space out an actor that doesn't have a next link
    if (!nextActorAttrs) {
      continue
    }

    const messageWidth = actorToMessageWidth[actorKey]
    const actorWidth = messageWidth + conf.actorMargin - actorAttrs.width / 2 - nextActorAttrs.width / 2

    actorAttrs.margin = Math.max(actorWidth, conf.actorMargin)
  }

  return Math.max(maxHeight, conf.actorHeight)
}

type MessageModel = {
  width: number
  height: number
  startx: number
  stopx: number
  starty: number
  stopy: number
  text: Message['text']
  type: Message['type']
  sequenceIndex?: number
  fromBound?: number
  toBound?: number
}

const buildMessageModel = function (msg: Message): MessageModel {
  const msgDims = utils.calculateTextDimensions(msg.text, messageFont(conf))
  let process = false
  if (
    [
      LINETYPE.SOLID_OPEN,
      LINETYPE.DOTTED_OPEN,
      LINETYPE.SOLID,
      LINETYPE.DOTTED,
      LINETYPE.SOLID_CROSS,
      LINETYPE.DOTTED_CROSS,
      LINETYPE.SOLID_POINT,
      LINETYPE.DOTTED_POINT,
    ].includes(msg.type)
  ) {
    process = true
  }
  if (!process) {
    return {
      width: msgDims.width,
      height: msgDims.height,
      startx: 0,
      starty: 0,
      text: msg.text,
      type: msg.type,
      stopx: msgDims.width,
      stopy: msgDims.height,
    }
  }
  const fromBound = activationBounds(msg.from)
  const toBound = activationBounds(msg.to)
  const fromIdx = fromBound[0] <= toBound[0] ? 1 : 0
  const toIdx = fromBound[0] < toBound[0] ? 0 : 1
  const allBounds = fromBound.concat(toBound)
  const boundedWidth = Math.abs(toBound[toIdx] - fromBound[fromIdx])
  // if (msg.wrap && msgModel.text) {
  //   msgModel.msgModel = utils.wrapLabel(
  //     msg.text,
  //     Math.max(boundedWidth + 2 * conf.wrapPadding, conf.width),
  //     messageFont(conf),
  //   )
  // }

  return {
    width: Math.max(
      msg.wrap ? 0 : msgDims.width + 2 * conf.wrapPadding,
      boundedWidth + 2 * conf.wrapPadding,
      conf.actorWidth,
    ),
    height: 0,
    startx: fromBound[fromIdx],
    stopx: toBound[toIdx],
    starty: 0,
    stopy: 0,
    text: msg.text,
    type: msg.type,
    wrap: msg.wrap,
    fromBound: Math.min.apply(null, allBounds),
    toBound: Math.max.apply(null, allBounds),
  } as MessageModel
}

type NoteModel = {
  width: number
  height: number
  startx: number
  stopx: number
  starty: number
  stopy: number
  text: Message['text']
  // type: Message['type']
  sequenceIndex?: number
  fromBound?: number
  toBound?: number
}

const buildNoteModel = function (msg: Message, actors: SequenceDiagramIR['actors']) {
  // console.log('build note model', msg)
  const fromActorAttr = model.actorAttrsMap.get(msg.from)
  const toActorAttr = model.actorAttrsMap.get(msg.to)

  let startx = fromActorAttr.x
  let stopx = toActorAttr.x
  let shouldWrap = msg.wrap && msg.text

  // let textDimensions = utils.calculateTextDimensions(
  //   shouldWrap ? utils.wrapLabel(msg.message, conf.width, noteFont(conf)) : msg.message,
  //   noteFont(conf)
  // );
  let textDimensions = utils.calculateTextDimensions(msg.text, noteFont(conf))
  // console.log('build note model, textDims', textDimensions)
  let noteModel: NoteModel = {
    width: shouldWrap ? conf.noteWidth : Math.max(conf.noteWidth, textDimensions.width + 2 * conf.noteMargin),
    height: 0,
    startx: fromActorAttr.x,
    stopx: 0,
    starty: 0,
    stopy: 0,
    text: msg.text,
  }
  if (msg.placement === PLACEMENT.RIGHTOF) {
    noteModel.width = shouldWrap
      ? Math.max(conf.noteWidth, textDimensions.width)
      : Math.max(fromActorAttr.width / 2 + toActorAttr.width / 2, textDimensions.width + 2 * conf.noteMargin)
    noteModel.startx = startx + (fromActorAttr.width + conf.actorMargin) / 2
  } else if (msg.placement === PLACEMENT.LEFTOF) {
    noteModel.width = shouldWrap
      ? Math.max(conf.noteWidth, textDimensions.width + 2 * conf.noteMargin)
      : Math.max(fromActorAttr.width / 2 + toActorAttr.width / 2, textDimensions.width + 2 * conf.noteMargin)
    noteModel.startx = startx - noteModel.width + (fromActorAttr.width - conf.actorMargin) / 2
  } else if (msg.to === msg.from) {
    textDimensions = utils.calculateTextDimensions(
      // shouldWrap
      //   ? utils.wrapLabel(msg.text, Math.max(conf.noteWidth, actors[msg.from].width), noteFont(conf))
      //   : msg.text,
      msg.text,
      noteFont(conf),
    )
    noteModel.width = shouldWrap
      ? Math.max(conf.noteWidth, fromActorAttr.width)
      : Math.max(fromActorAttr.width, conf.noteWidth, textDimensions.width + 2 * conf.noteMargin)
    noteModel.startx = startx + (fromActorAttr.width - noteModel.width) / 2
  } else {
    noteModel.width = Math.abs(startx + fromActorAttr.width / 2 - (stopx + toActorAttr.width / 2)) + conf.actorMargin
    noteModel.startx =
      startx < stopx
        ? startx + fromActorAttr.width / 2 - conf.actorMargin / 2
        : stopx + toActorAttr.width / 2 - conf.actorMargin / 2
  }
  // TODO: wrap
  // if (shouldWrap) {
  //   noteModel.message = utils.wrapLabel(
  //     msg.message,
  //     noteModel.width - 2 * conf.wrapPadding,
  //     noteFont(conf)
  //   );
  // }
  logger.debug(
    `NM:[${noteModel.startx},${noteModel.stopx},${noteModel.starty},${noteModel.stopy}:${noteModel.width},${noteModel.height}=${msg.text}]`,
  )
  return noteModel
}

const calculateLoopBounds = function (messages: Message[], actors: SequenceDiagramIR['actors']) {
  const loops = {}
  const stack = []
  let current, noteModel
  let msgModel: MessageModel

  messages.forEach(function (msg) {
    msg.id = utils.makeid(10)
    switch (msg.type) {
      case LINETYPE.LOOP_START:
      case LINETYPE.ALT_START:
      case LINETYPE.OPT_START:
      case LINETYPE.PAR_START:
        stack.push({
          id: msg.id,
          msg: msg.text,
          from: Number.MAX_SAFE_INTEGER,
          to: Number.MIN_SAFE_INTEGER,
          width: 0,
        })
        break
      case LINETYPE.ALT_ELSE:
      case LINETYPE.PAR_AND:
        if (msg.text) {
          current = stack.pop()
          loops[current.id] = current
          loops[msg.id] = current
          stack.push(current)
        }
        break
      case LINETYPE.LOOP_END:
      case LINETYPE.ALT_END:
      case LINETYPE.OPT_END:
      case LINETYPE.PAR_END:
        current = stack.pop()
        loops[current.id] = current
        break
      case LINETYPE.ACTIVE_START:
        {
          const actorName = msg.from || msg.to
          const actorRect = model.actorAttrsMap.get(actorName)
          const stackedSize = actorActivations(msg.from ? msg.from : msg.to).length
          // console.log('statcked size', stackedSize)
          const x = actorRect.x + actorRect.width / 2 + ((stackedSize - 1) * conf.activationWidth) / 2
          const toAdd = {
            startx: x,
            stopx: x + conf.activationWidth,
            actor: msg.from,
            starty: 0,
            stopy: 0,
            enabled: true,
          }
          model.activations.push(toAdd)
        }
        break
      case LINETYPE.ACTIVE_END:
        {
          const lastActorActivationIdx = model.activations.map(a => a.actor).lastIndexOf(msg.from)
          delete model.activations.splice(lastActorActivationIdx, 1)[0]
        }
        break
    }
    const isNote = msg.placement !== undefined
    if (isNote) {
      noteModel = buildNoteModel(msg, actors)
      model.noteModelMap.set(msg.id, noteModel)
      stack.forEach(stk => {
        current = stk
        current.from = Math.min(current.from, noteModel.startx)
        current.to = Math.max(current.to, noteModel.startx + noteModel.width)
        current.width = Math.max(current.width, Math.abs(current.from - current.to)) - conf.labelBoxWidth
      })
    } else {
      msgModel = buildMessageModel(msg)
      model.msgModelMap.set(msg.id, msgModel)

      if (msgModel.startx && msgModel.stopx && stack.length > 0) {
        stack.forEach(stk => {
          current = stk
          if (msgModel.startx === msgModel.stopx) {
            let from = model.actorAttrsMap.get(msg.from)
            let to = model.actorAttrsMap.get(msg.to)
            current.from = Math.min(from.x - msgModel.width / 2, from.x - from.width / 2, current.from)
            current.to = Math.max(to.x + msgModel.width / 2, to.x + from.width / 2, current.to)
            current.width = Math.max(current.width, Math.abs(current.to - current.from)) - conf.labelBoxWidth
          } else {
            current.from = Math.min(msgModel.startx, current.from)
            current.to = Math.max(msgModel.stopx, current.to)
            current.width = Math.max(current.width, msgModel.width) - conf.labelBoxWidth
          }
        })
      }
    }
  })
  model.activations = []
  logger.debug('Loop type widths:', loops)
  return loops
}

export default sequenceArtist
