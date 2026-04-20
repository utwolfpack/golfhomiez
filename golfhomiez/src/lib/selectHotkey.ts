export function jumpToFirstByLetter<T extends { value: string }>(
  key: string,
  items: T[],
  setValue: (v: string) => void,
  currentValue: string
) {
  const k = key.length === 1 ? key.toLowerCase() : ''
  if (!k || !/^[a-z0-9]$/.test(k)) return
  // If the current item already starts with that letter, jump to the next matching item.
  const startIdx = Math.max(0, items.findIndex((it) => it.value === currentValue))
  const matches = items.filter((it) => (it.value || '').toLowerCase().startsWith(k))
  if (matches.length === 0) return

  const currentMatchIdx = matches.findIndex((m) => m.value === currentValue)
  const next = currentMatchIdx >= 0 ? matches[(currentMatchIdx + 1) % matches.length] : matches[0]
  setValue(next.value)
}
