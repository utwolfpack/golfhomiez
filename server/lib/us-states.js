export const US_STATES = [
  ['AL', 'Alabama'], ['AK', 'Alaska'], ['AZ', 'Arizona'], ['AR', 'Arkansas'], ['CA', 'California'], ['CO', 'Colorado'], ['CT', 'Connecticut'], ['DE', 'Delaware'], ['FL', 'Florida'], ['GA', 'Georgia'],
  ['HI', 'Hawaii'], ['ID', 'Idaho'], ['IL', 'Illinois'], ['IN', 'Indiana'], ['IA', 'Iowa'], ['KS', 'Kansas'], ['KY', 'Kentucky'], ['LA', 'Louisiana'], ['ME', 'Maine'], ['MD', 'Maryland'],
  ['MA', 'Massachusetts'], ['MI', 'Michigan'], ['MN', 'Minnesota'], ['MS', 'Mississippi'], ['MO', 'Missouri'], ['MT', 'Montana'], ['NE', 'Nebraska'], ['NV', 'Nevada'], ['NH', 'New Hampshire'], ['NJ', 'New Jersey'],
  ['NM', 'New Mexico'], ['NY', 'New York'], ['NC', 'North Carolina'], ['ND', 'North Dakota'], ['OH', 'Ohio'], ['OK', 'Oklahoma'], ['OR', 'Oregon'], ['PA', 'Pennsylvania'], ['RI', 'Rhode Island'], ['SC', 'South Carolina'],
  ['SD', 'South Dakota'], ['TN', 'Tennessee'], ['TX', 'Texas'], ['UT', 'Utah'], ['VT', 'Vermont'], ['VA', 'Virginia'], ['WA', 'Washington'], ['WV', 'West Virginia'], ['WI', 'Wisconsin'], ['WY', 'Wyoming'],
  ['DC', 'District of Columbia'],
]

export const US_STATE_NAMES_BY_CODE = Object.freeze(Object.fromEntries(US_STATES))
export const US_STATE_CODES_BY_NAME = Object.freeze(Object.fromEntries(US_STATES.map(([code, name]) => [name.toLowerCase(), code])))

export function normalizeStateCode(value) {
  const text = String(value || '').replace(/\s+/g, ' ').trim()
  if (!text) return ''
  const upper = text.toUpperCase()
  if (/^[A-Z]{2}$/.test(upper)) return upper
  return US_STATE_CODES_BY_NAME[text.toLowerCase()] || upper.slice(0, 8)
}

export function stateNameForCode(value) {
  const code = normalizeStateCode(value)
  return US_STATE_NAMES_BY_CODE[code] || code
}
