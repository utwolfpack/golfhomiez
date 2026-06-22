export const DEFAULT_TEE_COLOR = 'white'
export const TEE_COLOR_OPTIONS = ['red', 'white', 'blue', 'black']

export function normalizeTeeColor(value) {
  const normalized = String(value || '').trim().toLowerCase()
  return TEE_COLOR_OPTIONS.includes(normalized) ? normalized : DEFAULT_TEE_COLOR
}

export function teeColorLabel(value) {
  const color = normalizeTeeColor(value)
  return color.charAt(0).toUpperCase() + color.slice(1)
}
