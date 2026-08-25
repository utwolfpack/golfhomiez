import { DEFAULT_TEE_TIME_INTERVAL_MINUTES, DEFAULT_TOURNAMENT_BANNER_URL, DEFAULT_TOURNAMENT_CHARITY_IMAGE_URL, DEFAULT_TOURNAMENT_CHARITY_MESSAGE, TOURNAMENT_TEAM_SIZE_OPTIONS, TOURNAMENT_TEMPLATES, emptyTournamentTemplateData, getTournamentTeamSize, type TournamentTemplateData } from '../lib/tournament-templates'
import ImageUploadField from './ImageUploadField'
import { compressImageFile } from '../lib/image-upload'
import { PHONE_PATTERN, PHONE_VALIDATION_MESSAGE, sanitizePhoneInput, validateOptionalPhoneNumber } from '../lib/phone-validation'
import { getCorrelationId, logFrontendEvent } from '../lib/frontend-logger'

export type TournamentTemplateFormValue = {
  startDate?: string | null
  templateKey?: string | null
  templateBackgroundImageUrl?: string | null
  templateData?: TournamentTemplateData | null
}

type Props = {
  value: TournamentTemplateFormValue
  onChange: (next: TournamentTemplateFormValue) => void
  hideRegistrationDeadline?: boolean
}

function normalizeCurrencyInput(rawValue: string): string {
  const raw = String(rawValue || '')
  const stripped = raw.replace(/[^\d.]/g, '')
  if (!stripped) return ''
  const [wholePart = '', ...decimalParts] = stripped.split('.')
  const whole = wholePart.replace(/^0+(?=\d)/, '') || '0'
  const decimals = decimalParts.join('').replace(/\D/g, '').slice(0, 2)
  return decimalParts.length ? `$${whole}.${decimals}` : `$${whole}`
}

function formatCurrencyInput(rawValue: string): string {
  const normalized = normalizeCurrencyInput(rawValue)
  if (!normalized) return ''
  const numeric = Number(normalized.replace(/[^\d.]/g, ''))
  if (!Number.isFinite(numeric)) return ''
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(numeric)
}

function Tooltip({ children }: { children: string }) {
  return (
    <span className="tournament-template-tooltip" tabIndex={0} aria-label={children}>
      ?
      <span className="tournament-template-tooltip-content" role="tooltip">{children}</span>
    </span>
  )
}

function lines(value?: string | null) {
  return String(value || '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
}

function BulletedTextarea({
  label,
  value,
  onChange,
}: {
  label: string
  value: string
  onChange: (next: string) => void
}) {
  const items = lines(value)
  const tooltip = `${label}: enter one item per row. Each new row appears as a bullet on the public tournament flyer.`
  return (
    <div>
      <label className="label tournament-template-label-with-tooltip">
        <span>{label}</span>
        <Tooltip>{tooltip}</Tooltip>
      </label>
      <textarea
        className="input"
        rows={3}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Enter one bullet item per row"
        aria-describedby={`${label.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}-hint`}
      />
      <div id={`${label.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}-hint`} className="small" style={{ marginTop: 4 }}>Each row becomes a bullet on the tournament flyer.</div>
      {items.length ? (
        <ul className="tournament-template-bullet-preview" aria-label={`${label} bullet preview`}>
          {items.map((item) => <li key={item}>{item}</li>)}
        </ul>
      ) : null}
    </div>
  )
}


export function TournamentRegistrationDeadlineField({ value, onChange }: Props) {
  const templateData = { ...emptyTournamentTemplateData(), ...(value.templateData || {}) }

  function updateTemplateData(next: Partial<TournamentTemplateData>) {
    onChange({ ...value, templateData: { ...templateData, ...next } })
  }

  function updateTextField(key: keyof TournamentTemplateData, rawValue: string) {
    const value = key === 'contactPhone' ? sanitizePhoneInput(rawValue) : rawValue
    updateTemplateData({ [key]: value })
  }

  return (
    <div>
      <label className="label">Registration deadline</label>
      <input
        className="input"
        type="date"
        value={String(templateData.registrationDeadline || '')}
        max={value.startDate || undefined}
        onChange={(e) => updateTemplateData({ registrationDeadline: e.target.value })}
      />
      <div className="small" style={{ marginTop: 4 }}>Last day golfers can register. The deadline cannot be after the tournament date.</div>
    </div>
  )
}

export function TournamentSummaryField({ value, onChange }: Props) {
  const templateData = { ...emptyTournamentTemplateData(), ...(value.templateData || {}) }
  const summary = String(templateData.tournamentSummary || '')

  return (
    <div className="card tournament-summary-editor" style={{ padding: 14, background: '#f8fafc' }}>
      <label className="label" htmlFor="tournament-summary">Tournament summary</label>
      <textarea
        id="tournament-summary"
        className="input"
        rows={5}
        maxLength={5000}
        value={summary}
        onChange={(event) => onChange({ ...value, templateData: { ...templateData, tournamentSummary: event.target.value } })}
        placeholder="Add final results, winners, memorable moments, charity totals, or other completed-tournament notes."
      />
      <div className="small" style={{ marginTop: 4 }}>When this tournament is completed, this summary appears below the final leaderboard on the public tournament page.</div>
    </div>
  )
}

export default function TournamentTemplateFields({ value, onChange, hideRegistrationDeadline = false }: Props) {
  const templateData = { ...emptyTournamentTemplateData(), ...(value.templateData || {}) }
  const supportingPhotoUrl = templateData.supportingPhotoUrl || ''
  const charityImageUrl = supportingPhotoUrl || DEFAULT_TOURNAMENT_CHARITY_IMAGE_URL
  const flyerBackgroundUrl = value.templateBackgroundImageUrl || ''

  function updateTemplateData(next: Partial<TournamentTemplateData>) {
    onChange({ ...value, templateData: { ...templateData, ...next } })
  }

  function updateTextField(key: keyof TournamentTemplateData, rawValue: string) {
    const value = key === 'contactPhone' ? sanitizePhoneInput(rawValue) : rawValue
    updateTemplateData({ [key]: value })
  }

  async function onLogoUpload(files?: FileList | null) {
    if (!files?.length) return
    const existing = Array.isArray(templateData.logoFiles) ? templateData.logoFiles : []
    const remainingSlots = Math.max(0, 18 - existing.length)
    const selectedFiles = Array.from(files).slice(0, remainingSlots)
    const encodedFiles = await Promise.all(selectedFiles.map((file) => compressImageFile(file, { maxWidth: 640, maxHeight: 640, quality: 0.72, maxBytes: 120 * 1024, minQuality: 0.45 }).then((result) => result.dataUrl)))
    updateTemplateData({ logoFiles: [...existing, ...encodedFiles].slice(0, 18) })
  }

  const textFields: Array<[keyof TournamentTemplateData, string, string?]> = [
    ['beneficiaryCharity', 'Beneficiary / Charity'],
    ['checkInTime', 'Check-in time', 'time'],
    ['teeTime', 'Tee time', 'time'],
    ['contactPerson', 'Contact person'],
    ['contactPhone', 'Contact phone'],
    ['contactEmail', 'Contact email', 'email'],
  ]

  return (
    <div className="card" style={{ padding: 16 }}>
      <ImageUploadField
        label="Flyer background image"
        value={flyerBackgroundUrl}
        emptyText={`No flyer background uploaded. The default banner ${DEFAULT_TOURNAMENT_BANNER_URL} will be used.`}
        previewAlt="Selected flyer background preview"
        options={{ maxWidth: 1400, maxHeight: 700, quality: 0.72, maxBytes: 420 * 1024, minQuality: 0.42, correlationData: { usage: 'tournament_flyer_background' } }}
        onChange={(dataUrl) => onChange({ ...value, templateBackgroundImageUrl: dataUrl })}
        onRemove={() => onChange({ ...value, templateBackgroundImageUrl: null })}
      />

      <ImageUploadField
        label="Charity Image (optional)"
        value={supportingPhotoUrl}
        previewValue={charityImageUrl}
        emptyText={`No charity image uploaded. The default charity image ${DEFAULT_TOURNAMENT_CHARITY_IMAGE_URL} will be used.`}
        previewAlt="Selected charity image preview"
        options={{ maxWidth: 1000, maxHeight: 1000, quality: 0.74, maxBytes: 320 * 1024, minQuality: 0.42, correlationData: { usage: 'tournament_charity_image' } }}
        onChange={(dataUrl) => updateTemplateData({ supportingPhotoUrl: dataUrl })}
        onRemove={() => updateTemplateData({ supportingPhotoUrl: '' })}
      />

      <div className="tournament-template-selector" style={{ marginTop: 16 }}>
        <div className="tournament-template-selector-heading">
          <div>
            <label className="label">Flyer template</label>
            <div className="small">Choose the public flyer layout. Switching templates keeps the tournament data you already entered.</div>
          </div>
          <span className="tournament-template-selector-count">{TOURNAMENT_TEMPLATES.length} layouts</span>
        </div>
        <div className="tournament-template-selector-grid" role="radiogroup" aria-label="Tournament flyer template">
          {TOURNAMENT_TEMPLATES.map((template) => {
            const selected = (value.templateKey || 'classic-flyer') === template.key
            return (
              <button
                key={template.key}
                type="button"
                role="radio"
                aria-checked={selected}
                className={`tournament-template-option${selected ? ' tournament-template-option--selected' : ''}`}
                onClick={() => {
                  const correlationId = getCorrelationId()
                  onChange({ ...value, templateKey: template.key })
                  logFrontendEvent({
                    category: 'tournament.template',
                    message: 'tournament_flyer_template_selected',
                    data: { templateKey: template.key, templateName: template.name, correlationId },
                  })
                }}
              >
                <span className={`tournament-template-preview ${template.previewClassName}`} aria-hidden="true">
                  <span className="tournament-template-preview-title">GOLF</span>
                  <span className="tournament-template-preview-rule" />
                  <span className="tournament-template-preview-detail" />
                  <span className="tournament-template-preview-detail tournament-template-preview-detail--short" />
                </span>
                <span className="tournament-template-option-copy">
                  <strong>{template.name}</strong>
                  <span>{template.description}</span>
                </span>
                <span className="tournament-template-option-check" aria-hidden="true">{selected ? '✓' : ''}</span>
              </button>
            )
          })}
        </div>
      </div>

      <div style={{ marginTop: 14 }}>
        <label className="label">Beneficiary / Charity message</label>
        <textarea
          className="input"
          rows={3}
          value={String(templateData.charityMessage || DEFAULT_TOURNAMENT_CHARITY_MESSAGE)}
          onChange={(e) => updateTemplateData({ charityMessage: e.target.value })}
        />
        <div className="small" style={{ marginTop: 4 }}>This message appears in the Beneficiary / Charity section of the public tournament page.</div>
      </div>


      <div style={{ marginTop: 14 }}>
        <label className="label">Location</label>
        <textarea
          className="input"
          rows={2}
          value={String(templateData.locationAddress || '')}
          onChange={(e) => updateTemplateData({ locationAddress: e.target.value })}
          placeholder="Physical address for the tournament"
        />
        <div className="small" style={{ marginTop: 4 }}>Defaults to the golf-course address when available. Edit this when the tournament uses a different location or needs extra directions.</div>
      </div>

      <div className="formRow formRow--split" style={{ marginTop: 14 }}>
        {textFields.map(([key, label, type]) => (
          <div key={key}>
            <label className="label">{label}</label>
            <input
              className="input"
              type={key === 'contactPhone' ? 'tel' : type || 'text'}
              inputMode={key === 'contactPhone' ? 'tel' : undefined}
              pattern={key === 'contactPhone' ? PHONE_PATTERN : undefined}
              title={key === 'contactPhone' ? PHONE_VALIDATION_MESSAGE : undefined}
              aria-invalid={key === 'contactPhone' && Boolean(templateData.contactPhone && validateOptionalPhoneNumber(templateData.contactPhone))}
              value={String(templateData[key] || '')}
              onChange={(e) => updateTextField(key, e.target.value)}
              placeholder={key === 'contactPhone' ? '801 743 7000' : undefined}
            />
          </div>
        ))}
        {!hideRegistrationDeadline ? <TournamentRegistrationDeadlineField value={value} onChange={onChange} /> : null}
        <div>
          <label className="label">Players on a team</label>
          <select
            className="input"
            value={getTournamentTeamSize(templateData)}
            onChange={(e) => {
              const tournamentTeamSize = Number(e.target.value)
              updateTemplateData({ tournamentTeamSize, tournamentFormat: `${tournamentTeamSize}-Player Team` })
              logFrontendEvent({ category: 'tournament.builder', message: 'tournament_team_size_changed', data: { correlationId: getCorrelationId(), tournamentTeamSize } })
            }}
          >
            {TOURNAMENT_TEAM_SIZE_OPTIONS.map((size) => <option key={size} value={size}>{size} players per team</option>)}
          </select>
          <div className="small" style={{ marginTop: 4 }}>Registration teams must contain exactly this many golfers.</div>
        </div>
        <div>
          <label className="label tournament-template-label-with-tooltip">
            <span>Entry fee</span>
            <Tooltip>Currency only. Enter dollars and cents, for example $125.00.</Tooltip>
          </label>
          <input
            className="input"
            type="text"
            inputMode="decimal"
            pattern="^\$?\d+(\.\d{0,2})?$"
            value={String(templateData.entryFee || '')}
            onChange={(e) => updateTemplateData({ entryFee: normalizeCurrencyInput(e.target.value) })}
            onBlur={(e) => updateTemplateData({ entryFee: formatCurrencyInput(e.target.value) })}
            placeholder="$0.00"
            aria-label="Entry fee currency amount"
          />
        </div>
      </div>

      <div className="formRow formRow--split" style={{ marginTop: 14 }}>
        <div>
          <label className="label">Team start method</label>
          <select className="input" value={templateData.startType || 'shotgun'} onChange={(e) => updateTemplateData({ startType: e.target.value })}>
            <option value="shotgun">Shotgun Start</option>
            <option value="tee-times">Tee times</option>
          </select>
          <div className="small" style={{ marginTop: 4 }}>After teams register, the host or organizer can auto-create and edit each team’s start time and starting hole.</div>
        </div>
        {templateData.startType === 'tee-times' ? (
          <div>
            <label className="label">Tee-time interval (minutes)</label>
            <input
              className="input"
              type="number"
              min={5}
              max={60}
              step={1}
              value={Number(templateData.teeTimeIntervalMinutes || DEFAULT_TEE_TIME_INTERVAL_MINUTES)}
              onChange={(e) => updateTemplateData({ teeTimeIntervalMinutes: Math.min(60, Math.max(5, Number(e.target.value) || DEFAULT_TEE_TIME_INTERVAL_MINUTES)) })}
            />
          </div>
        ) : null}
      </div>

      <div className="formRow formRow--split" style={{ marginTop: 14 }}>
        <BulletedTextarea label="What fees include" value={String(templateData.feesInclude || '')} onChange={(next) => updateTemplateData({ feesInclude: next })} />
        <BulletedTextarea label="Prize details" value={String(templateData.prizeDetails || '')} onChange={(next) => updateTemplateData({ prizeDetails: next })} />
        <BulletedTextarea label="Hole contests/extras" value={String(templateData.holeContestsExtras || '')} onChange={(next) => updateTemplateData({ holeContestsExtras: next })} />
        <div>
          <label className="label">Misc Notes</label>
          <textarea className="input" rows={3} value={String(templateData.miscNotes || '')} onChange={(e) => updateTemplateData({ miscNotes: e.target.value })} />
        </div>
      </div>

      <div style={{ marginTop: 14 }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 700 }}>
          <input
            type="checkbox"
            checked={Boolean(templateData.sponsorsAvailable)}
            onChange={(e) => updateTemplateData({ sponsorsAvailable: e.target.checked })}
          />
          Sponsors available
        </label>
        <div className="small" style={{ marginTop: 4 }}>When checked, the tournament page sponsor section shows that sponsor opportunities are available.</div>
      </div>

      <div style={{ marginTop: 14 }}>
        <label className="label">Logo files (up to 18)</label>
        <input className="input" type="file" accept="image/*" multiple onChange={(e) => { void onLogoUpload(e.target.files); e.currentTarget.value = '' }} />
        <div className="small" style={{ marginTop: 4 }}>{(templateData.logoFiles || []).length} of 18 logos uploaded.</div>
        {templateData.logoFiles?.length ? (
          <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(90px, 1fr))', gap: 8, marginTop: 8 }}>
            {templateData.logoFiles.map((logo, index) => (
              <div key={`${logo.slice(0, 24)}-${index}`} className="card" style={{ padding: 8 }}>
                <img src={logo} alt={`Sponsor logo ${index + 1}`} style={{ width: '100%', height: 50, objectFit: 'contain' }} />
                <button type="button" className="btn" style={{ marginTop: 6, width: '100%' }} onClick={() => updateTemplateData({ logoFiles: (templateData.logoFiles || []).filter((_, logoIndex) => logoIndex !== index) })}>Remove</button>
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  )
}
