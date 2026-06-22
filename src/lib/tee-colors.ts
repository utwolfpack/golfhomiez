export type TeeColor = 'red' | 'white' | 'blue' | 'black'
export type TeeColorSelection = TeeColor | ''

export const DEFAULT_TEE_COLOR: TeeColor = 'white'

export const TEE_COLOR_OPTIONS: Array<{ value: TeeColor; label: string; className: string }> = [
  { value: 'red', label: 'Red', className: 'teeSelectorOption--red' },
  { value: 'white', label: 'White', className: 'teeSelectorOption--white' },
  { value: 'blue', label: 'Blue', className: 'teeSelectorOption--blue' },
  { value: 'black', label: 'Black', className: 'teeSelectorOption--black' },
]

export function normalizeTeeColor(value: unknown): TeeColor {
  const normalized = String(value || '').trim().toLowerCase()
  return TEE_COLOR_OPTIONS.some((option) => option.value === normalized) ? normalized as TeeColor : DEFAULT_TEE_COLOR
}

export function teeColorLabel(value: unknown) {
  const color = normalizeTeeColor(value)
  return TEE_COLOR_OPTIONS.find((option) => option.value === color)?.label || 'White'
}
