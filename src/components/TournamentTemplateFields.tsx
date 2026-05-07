import { TOURNAMENT_TEMPLATES, emptyTournamentTemplateData, getTournamentTemplate, type TournamentTemplateData } from '../lib/tournament-templates'
import ImageUploadField from './ImageUploadField'
import { compressImageFile } from '../lib/image-upload'

export type TournamentTemplateFormValue = {
  templateKey?: string | null
  templateBackgroundImageUrl?: string | null
  templateData?: TournamentTemplateData | null
}

type Props = {
  value: TournamentTemplateFormValue
  onChange: (next: TournamentTemplateFormValue) => void
}

export default function TournamentTemplateFields({ value, onChange }: Props) {
  const selected = getTournamentTemplate(value.templateKey)
  const templateData = { ...emptyTournamentTemplateData(), ...(value.templateData || {}) }
  const supportingPhotoUrl = templateData.supportingPhotoUrl || ''
  const flyerBackgroundUrl = value.templateBackgroundImageUrl || ''

  function updateTemplateData(next: Partial<TournamentTemplateData>) {
    onChange({ ...value, templateData: { ...templateData, ...next } })
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
    ['hostOrganization', 'Host organization'],
    ['beneficiaryCharity', 'Beneficiary/charity'],
    ['checkInTime', 'Check-in time', 'time'],
    ['tournamentFormat', 'Tournament format'],
    ['registrationDeadline', 'Registration deadline', 'date'],
    ['entryFee', 'Entry fee'],
    ['contactPerson', 'Contact person'],
    ['contactPhone', 'Contact phone'],
    ['contactEmail', 'Contact email', 'email'],
  ]

  return (
    <div className="card" style={{ padding: 16 }}>
      <div style={{ fontWeight: 700 }}>Tournament page design</div>
      <p className="small" style={{ marginTop: 4 }}>Use the clean golf flyer template with uploaded icons for the key tournament attributes. Organizer-uploaded background images are compressed and shown behind the flyer content.</p>
      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12, marginTop: 12 }}>
        {TOURNAMENT_TEMPLATES.map((template) => {
          const checked = (value.templateKey || TOURNAMENT_TEMPLATES[0].key) === template.key
          return (
            <label key={template.key} className="card" style={{ padding: 10, borderColor: checked ? template.accentColor : undefined, cursor: 'pointer' }}>
              <div style={{ minHeight: 170, borderRadius: 12, background: '#fff', border: '1px solid #d1d5db', padding: 14 }}>
                <div style={{ fontWeight: 900, color: template.accentColor, fontSize: 24, textAlign: 'center', textTransform: 'uppercase' }}>Tournament Name</div>
                <div className="formStack" style={{ gap: 6, marginTop: 12 }}>
                  {Object.entries(template.attributeIcons).slice(0, 6).map(([key, icon]) => (
                    <div key={key} style={{ display: 'grid', gridTemplateColumns: '36px 1fr', gap: 8, alignItems: 'center', borderTop: '1px solid #b7d7ad', paddingTop: 5 }}>
                      <img src={icon} alt="" aria-hidden="true" style={{ width: 30, height: 30, objectFit: 'contain' }} />
                      <div style={{ height: 12, background: '#e5efe2', borderRadius: 999 }} />
                    </div>
                  ))}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 8 }}>
                <input type="radio" name="tournamentTemplate" checked={checked} onChange={() => onChange({ ...value, templateKey: template.key })} />
                <span className="small" style={{ fontWeight: 700 }}>{template.name}</span>
              </div>
              <div className="small">{template.description}</div>
            </label>
          )
        })}
      </div>

      <ImageUploadField
        label="Flyer background image"
        value={flyerBackgroundUrl}
        emptyText="No flyer background uploaded."
        previewAlt="Selected flyer background preview"
        options={{ maxWidth: 1400, maxHeight: 700, quality: 0.72, maxBytes: 420 * 1024, minQuality: 0.42, correlationData: { usage: 'tournament_flyer_background' } }}
        onChange={(dataUrl) => onChange({ ...value, templateBackgroundImageUrl: dataUrl })}
        onRemove={() => onChange({ ...value, templateBackgroundImageUrl: null })}
      />

      <ImageUploadField
        label="Supporting photo (optional)"
        value={supportingPhotoUrl}
        emptyText="No supporting photo uploaded."
        previewAlt="Selected supporting photo preview"
        options={{ maxWidth: 1000, maxHeight: 1000, quality: 0.74, maxBytes: 320 * 1024, minQuality: 0.42, correlationData: { usage: 'tournament_supporting_photo' } }}
        onChange={(dataUrl) => updateTemplateData({ supportingPhotoUrl: dataUrl })}
        onRemove={() => updateTemplateData({ supportingPhotoUrl: '' })}
      />

      <div className="formRow formRow--split" style={{ marginTop: 14 }}>
        <div>
          <label className="label">Tournament Name</label>
          <input className="input" value={templateData.tournamentName || ''} onChange={(e) => updateTemplateData({ tournamentName: e.target.value })} />
        </div>
        {textFields.map(([key, label, type]) => (
          <div key={key}>
            <label className="label">{label}</label>
            <input className="input" type={type || 'text'} value={String(templateData[key] || '')} onChange={(e) => updateTemplateData({ [key]: e.target.value })} />
          </div>
        ))}
      </div>

      <div style={{ marginTop: 14 }}>
        <label className="label">Shotgun Start or tee times</label>
        <select className="input" value={templateData.startType || 'shotgun'} onChange={(e) => updateTemplateData({ startType: e.target.value })}>
          <option value="shotgun">Shotgun Start</option>
          <option value="tee-times">Tee times</option>
        </select>
      </div>

      <div className="formRow formRow--split" style={{ marginTop: 14 }}>
        {([
          ['feesInclude', 'What fees include'],
          ['prizeDetails', 'Prize details'],
          ['holeContestsExtras', 'Hole contests/extras'],
          ['miscNotes', 'Misc Notes'],
        ] as Array<[keyof TournamentTemplateData, string]>).map(([key, label]) => (
          <div key={key}>
            <label className="label">{label}</label>
            <textarea className="input" rows={3} value={String(templateData[key] || '')} onChange={(e) => updateTemplateData({ [key]: e.target.value })} />
          </div>
        ))}
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
