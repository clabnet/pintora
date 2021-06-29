import nearley from 'nearley'
import db from './db'
import grammar, { setYY } from './parser/erDiagram'
import { compact } from '@pintora/core'

setYY(db)

export function parse(text: string) {
  // should construct a brand new parser everytime
  const parser = new nearley.Parser(nearley.Grammar.fromCompiled(grammar))
  parser.feed(text)
  return compact(parser.results)
}