/**
 * This module evaluate custom style params to real configs
 */
import { parseColor } from './util/color'

export type StyleValueType = 'color' | 'size' | 'fontSize' | 'string' | 'boolean' | 'layoutDirection'

export type StyleMeta = {
  valueType: StyleValueType
}

export type StyleParam<K = string> = {
  key: K
  value: string
}

type StyleEvaluateResult<T> = { valid: true; value: T } | { valid: false }

export type TLayoutDirection = 'LR' | 'TB'

interface StyleValueTypeMap {
  color: string
  size: number
  fontSize: number
  string: string
  boolean: boolean
  layoutDirection: TLayoutDirection
}

const sizeEvaluator = ({ value }: any): StyleEvaluateResult<number> => {
  const parsed = parseInt(value)
  if (isNaN(parsed)) return { valid: false }
  return { value: parsed, valid: true }
}

const styleValueEvaluators: { [K in StyleValueType]: (p: StyleParam) => StyleEvaluateResult<StyleValueTypeMap[K]> } = {
  color({ value }) {
    const parsed = parseColor(value)
    return { value: parsed.color, valid: true }
  },
  size: sizeEvaluator,
  fontSize: sizeEvaluator,
  string({ value }) {
    return { value, valid: true }
  },
  boolean({ value }) {
    return { value: value === 'true', valid: true }
  },
  layoutDirection({ value }) {
    return { value: value as any, valid: true }
  },
}

type StyleRuleMap = Record<string, StyleMeta>

/**
 * Generate style config from style params
 */
export function interpreteStyles<T extends StyleRuleMap>(
  ruleMap: T,
  params: StyleParam[],
): { [K in keyof T]: T[K]['valueType'] extends StyleValueType[] ? any : StyleValueTypeMap[T[K]['valueType']] } {
  const out: any = {}
  params.forEach(param => {
    const meta = ruleMap[param.key]
    if (!meta) return
    const valueTypes: StyleValueType[] = Array.isArray(meta.valueType) ? meta.valueType : [meta.valueType]
    for (const valueType of valueTypes) {
      const evaluator = styleValueEvaluators[valueType]
      if (!evaluator) continue
      const result = evaluator(param)
      if (result.valid) {
        out[param.key] = result.value
        return
      }
    }
  })
  // console.log('interpreteStyles', out)
  return out
}
