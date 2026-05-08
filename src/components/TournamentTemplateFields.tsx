import { DEFAULT_TOURNAMENT_BANNER_URL, DEFAULT_TOURNAMENT_CHARITY_IMAGE_URL, DEFAULT_TOURNAMENT_CHARITY_MESSAGE, emptyTournamentTemplateData, type TournamentTemplateData } from '../lib/tournament-templates'
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
  const templateData = { ...emptyTournamentTemplateData(), ...(value.templateData || {}) }
  const supportingPhotoUrl = templateData.supportingPhotoUrl || ''
  const charityImageUrl = supportingPhotoUrl || DEFAULT_TOURNAMENT_CHARITY_IMAGE_URL
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
    ['beneficiaryCharity', 'Beneficiary / Charity'],
    ['checkInTime', 'Check-in time', 'time'],
    ['teeTime', 'Tee time', 'time'],
    ['tournamentFormat', 'Tournament format'],
    ['registrationDeadline', 'Registration deadline', 'date'],
    ['entryFee', 'Entry fee'],
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
