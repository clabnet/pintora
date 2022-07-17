import db from './db'
import grammar from './parser/dotDiagram'
import { genParserWithRules } from '../util/parser-util'

export const parse = genParserWithRules(grammar, {
  dedupeAmbigousResults: true,
  postProcess(results) {
    db.apply(results)
    return results
  },
})
