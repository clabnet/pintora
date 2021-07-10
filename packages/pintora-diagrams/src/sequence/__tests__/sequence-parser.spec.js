import { parse } from '../parser'
import { db } from '../db'
import { stripStartEmptyLines } from '@pintora/test-shared'

describe('sequence parser', () => {
  afterEach(() => {
    db.clear()
  })

  it('can parse unicode chars', () => {
    const backquoteExample = stripStartEmptyLines(`
sequenceDiagram
  autonumber
  用户->>+Pintora: 帮我画张时序图
  activate Pintora
  alt DSL 正确
    Pintora->>用户: 返回绘制好的图表
  else DSL 有误
    Pintora->>用户: 返回报错信息
  end
  deactivate Pintora`)
    parse(backquoteExample)
    const result = db.getDiagramIR()
    expect(result.messages.length).toBeGreaterThan(0)
    // console.log(result.messages)
  })

  it('can parse singleline note', () => {
    const backquoteExample = `sequenceDiagram
    @note right of User: singleline note
    `
    parse(backquoteExample)
    const result = db.getDiagramIR()
    // console.log('notes', result.notes)
    expect(result.notes.length).toEqual(1)
    expect(result.notes[0]).toMatchObject({
      text: 'singleline note',
    })
  })

  it('can parse multiline note', () => {
    const multilineNoteExample = stripStartEmptyLines(`
sequenceDiagram
  @note right of Pintora
  aaa note
  bbb
  @end_note
    `)
    parse(multilineNoteExample)
    const result = db.getDiagramIR()
    // console.log('notes', result.notes)
    expect(result.notes.length).toEqual(1)
    // parseMessage will trim text, so this may be somehow strange
    expect(result.notes[0]).toMatchObject({
      text: 'aaa note\n  bbb',
    })
  })

  it('can parse divider', () => {
    const example = stripStartEmptyLines(`
sequenceDiagram
  Alice-->Bob: hello
  == 1 second later ==
  Bob-->Alice: hello there`)
    parse(example)
    const result = db.getDiagramIR()
    expect(result.messages.length).toEqual(3)
    expect(result.messages[1]).toMatchObject({
      text: '1 second later',
    })
  })

  it('can parse participant', () => {
    const example = stripStartEmptyLines(`
sequenceDiagram
  participant A as Alice
  participant B as Bob
  A-->B: hello
  `)
    parse(example)
    const result = db.getDiagramIR()
    expect(result.actors['A']).toMatchObject({
      description: 'Alice',
    })
    expect(result.actors['B']).toMatchObject({
      description: 'Bob',
    })
    expect(result.messages[0]).toMatchObject({
      from: 'A',
      to: 'B',
    })
  })
})