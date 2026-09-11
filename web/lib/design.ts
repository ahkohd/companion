import schema from '../../shared/design-schema.json'
import defaults from '../../shared/studio-defaults.json'
import type { ModuleId } from './studio'

export type DesignValues = Record<string, number>

export type Designs = Record<ModuleId, DesignValues>

export interface DesignField {
  key: string
  label: string
  group: string
  default: number
  min: number
  max: number
  options?: number[]
  type?: string
  allowAuto?: boolean
  unit?: string
}

export const designSchema = schema as Record<ModuleId, DesignField[]>
export const defaultDesign = defaults.design as Designs

export const colorHex = (value: number) => `#${value.toString(16).padStart(6, '0')}`

export const sansLine = (size: number) => Math.round(size * 1.22)

export const pixelLine = (size: number) => Math.round(size * 1.22)

export const percentageTop = (size: number) => {
  const y = 65 - pixelLine(size) / 2

  return Math.sign(y) * Math.round(Math.abs(y))
}

export function designFor(design: Partial<Designs> | undefined, module: ModuleId): DesignValues {
  return { ...defaultDesign[module], ...design?.[module] }
}

export function validateDesign(value: unknown): Designs {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw Error('Choose a Companion design file.')
  }

  const result = structuredClone(defaultDesign)

  for (const [module, fields] of Object.entries(value)) {
    if (
      !(module in designSchema) ||
      !fields ||
      typeof fields !== 'object' ||
      Array.isArray(fields)
    ) {
      throw Error('Unknown module in design file.')
    }

    for (const [key, n] of Object.entries(fields)) {
      const field = designSchema[module as ModuleId].find((f) => f.key === key)

      if (
        !field ||
        typeof n !== 'number' ||
        !Number.isInteger(n) ||
        (!(field.allowAuto && n === 0) && n < field.min) ||
        n > field.max ||
        (field.options && !field.options.includes(n))
      ) {
        throw Error(`Invalid design value: ${module}.${key}`)
      }

      result[module as ModuleId][key] = n
    }
  }

  return result
}
