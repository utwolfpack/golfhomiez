import { TEE_COLOR_OPTIONS, type TeeColor, type TeeColorSelection } from '../lib/tee-colors'
import { logFrontendEvent } from '../lib/frontend-logger'

export default function TeeColorSelector({
  value,
  onChange,
  label = 'Tees',
  disabled = false,
}: {
  value?: TeeColorSelection | null
  onChange: (next: TeeColor) => void
  label?: string
  disabled?: boolean
}) {
  const selectedValue = value || ''

  function selectTeeColor(next: TeeColor) {
    onChange(next)
    logFrontendEvent({
      category: 'tee.selection',
      message: 'tee_color_selected',
      data: { label, teeColor: next },
    })
  }

  return (
    <fieldset className="teeSelector" disabled={disabled}>
      <legend>{label}</legend>
      <div className="teeSelectorOptions" role="radiogroup" aria-label={label}>
        {TEE_COLOR_OPTIONS.map((option) => (
          <label key={option.value} className={`teeSelectorOption ${option.className}${selectedValue === option.value ? ' teeSelectorOption--selected' : ''}`}>
            <input
              type="radio"
              name={label.replace(/\s+/g, '-').toLowerCase()}
              value={option.value}
              checked={selectedValue === option.value}
              onChange={() => selectTeeColor(option.value)}
            />
            <span className="teeSelectorSwatch" aria-hidden="true" />
            <span>{option.label}</span>
          </label>
        ))}
      </div>
      {!selectedValue ? <div className="small teeSelectorHelp">Default is White tees when no selection is made.</div> : null}
    </fieldset>
  )
}
