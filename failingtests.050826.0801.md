
> golf-scramble-app@1.0.0 test
> node --test test/app.test.js test/schema-rollback.test.js

TAP version 13
# Subtest: email helpers normalize and validate addresses
ok 1 - email helpers normalize and validate addresses
  ---
  duration_ms: 2.7361
  ...
# Subtest: forgot password client points at the correct Better Auth endpoint
ok 2 - forgot password client points at the correct Better Auth endpoint
  ---
  duration_ms: 0.7965
  ...
# Subtest: better auth client prefers same-origin in deployed environments and only allows loopback cross-origin locally
ok 3 - better auth client prefers same-origin in deployed environments and only allows loopback cross-origin locally
  ---
  duration_ms: 0.3128
  ...
# Subtest: API client attaches the user timezone header for server-side date validation
ok 4 - API client attaches the user timezone header for server-side date validation
  ---
  duration_ms: 0.3675
  ...
# Subtest: create-team normalization always makes the signed-in user the first member
ok 5 - create-team normalization always makes the signed-in user the first member
  ---
  duration_ms: 1.6256
  ...
# Subtest: locked lead member falls back to the email local-part when the user name is unavailable
ok 6 - locked lead member falls back to the email local-part when the user name is unavailable
  ---
  duration_ms: 0.1505
  ...
# Subtest: team creation UI uses email lookup, prevents duplicates, shows pending invites, and hides the add input at four golfers
ok 7 - team creation UI uses email lookup, prevents duplicates, shows pending invites, and hides the add input at four golfers
  ---
  duration_ms: 0.5191
  ...
# Subtest: date helpers reject future dates in the supplied local timezone
ok 8 - date helpers reject future dates in the supplied local timezone
  ---
  duration_ms: 17.2924
  ...
# Subtest: score logger pages use the user-local date helper for date picker limits
ok 9 - score logger pages use the user-local date helper for date picker limits
  ---
  duration_ms: 0.7521
  ...
# Subtest: solo logger supports optional 18-hole entry like the team logger
ok 10 - solo logger supports optional 18-hole entry like the team logger
  ---
  duration_ms: 0.4451
  ...
# Subtest: logged event rows remain clickable buttons for round detail access
ok 11 - logged event rows remain clickable buttons for round detail access
  ---
  duration_ms: 0.5962
  ...
# Subtest: handicap UI is clickable, filter-relative, and shows a breakdown modal
ok 12 - handicap UI is clickable, filter-relative, and shows a breakdown modal
  ---
  duration_ms: 1.0412
  ...
# Subtest: validation warnings stay hidden until save is attempted
ok 13 - validation warnings stay hidden until save is attempted
  ---
  duration_ms: 0.6206
  ...
# Subtest: homepage shows guest sample scores when no user is logged in
ok 14 - homepage shows guest sample scores when no user is logged in
  ---
  duration_ms: 0.5123
  ...
# Subtest: logging writes to root access and error log files with request middleware support
ok 15 - logging writes to root access and error log files with request middleware support
  ---
  duration_ms: 0.8253
  ...
# Subtest: profile page removes state code, uses smiley selection, and redirects home after save
ok 16 - profile page removes state code, uses smiley selection, and redirects home after save
  ---
  duration_ms: 0.8047
  ...
# Subtest: profile server schema and migration remove primary_state_code and reject conflicting preferences
ok 17 - profile server schema and migration remove primary_state_code and reject conflicting preferences
  ---
  duration_ms: 1.1973
  ...
# Subtest: homepage demo seeder can populate the sample rounds locally
ok 18 - homepage demo seeder can populate the sample rounds locally
  ---
  duration_ms: 0.6003
  ...
# Subtest: safe mobile diagnostics use pixel beacons instead of recursive preboot network logging
ok 19 - safe mobile diagnostics use pixel beacons instead of recursive preboot network logging
  ---
  duration_ms: 0.9402
  ...
# Subtest: register route stays lazy-loaded to avoid pulling mobile-only register code into the initial bundle
ok 20 - register route stays lazy-loaded to avoid pulling mobile-only register code into the initial bundle
  ---
  duration_ms: 0.3645
  ...
# Subtest: location resources use backend endpoints and keep datasets off the client
ok 21 - location resources use backend endpoints and keep datasets off the client
  ---
  duration_ms: 22.6283
  ...
# Subtest: mobile location lookup runs on the server and keeps browser datasets out of the client
ok 22 - mobile location lookup runs on the server and keeps browser datasets out of the client
  ---
  duration_ms: 1.3332
  ...
# Subtest: the package test script targets the maintained test suite files
ok 23 - the package test script targets the maintained test suite files
  ---
  duration_ms: 0.4201
  ...
# Subtest: auth session lifetime is set to 24 hours and registration signs the user out until verification
ok 24 - auth session lifetime is set to 24 hours and registration signs the user out until verification
  ---
  duration_ms: 0.8973
  ...
# Subtest: legacy users are backfilled as verified while new sign-ins still require verification
ok 25 - legacy users are backfilled as verified while new sign-ins still require verification
  ---
  duration_ms: 0.7321
  ...
# Subtest: smtp logging has a dedicated smtp log with shared correlation ids
ok 26 - smtp logging has a dedicated smtp log with shared correlation ids
  ---
  duration_ms: 0.7596
  ...
# Subtest: verification flow prepopulates email and shows registration completion guidance
ok 27 - verification flow prepopulates email and shows registration completion guidance
  ---
  duration_ms: 0.2903
  ...
# Subtest: navigation uses the styled dropdown menu items and keeps invite access available
ok 28 - navigation uses the styled dropdown menu items and keeps invite access available
  ---
  duration_ms: 0.4581
  ...
# Subtest: teams page shows pending verification states, registration invites, and restored edit capability
ok 29 - teams page shows pending verification states, registration invites, and restored edit capability
  ---
  duration_ms: 0.319
  ...
# Subtest: registration routes stay same-origin and client log ingestion supports both legacy and current endpoints
ok 30 - registration routes stay same-origin and client log ingestion supports both legacy and current endpoints
  ---
  duration_ms: 0.6413
  ...
# Subtest: client log ingestion endpoints support singular and plural routes
ok 31 - client log ingestion endpoints support singular and plural routes
  ---
  duration_ms: 5.8958
  ...
# Subtest: auth API defaults to same-origin auth in deployed environments when override origin mismatches
ok 32 - auth API defaults to same-origin auth in deployed environments when override origin mismatches
  ---
  duration_ms: 0.4545
  ...
# Subtest: app startup resets session log files so logs only reflect the current session
ok 33 - app startup resets session log files so logs only reflect the current session
  ---
  duration_ms: 0.6597
  ...
# Subtest: profile enrichment runs on first sign-in and adds editable profile fields with location prefill
ok 34 - profile enrichment runs on first sign-in and adds editable profile fields with location prefill
  ---
  duration_ms: 0.8891
  ...
# Subtest: profile API and migration support one-time enrichment and stored location preferences
ok 35 - profile API and migration support one-time enrichment and stored location preferences
  ---
  duration_ms: 1.348
  ...
# Subtest: host auth flow adds direct host routes, public account requests, invite redemption, and reset endpoints
ok 36 - host auth flow adds direct host routes, public account requests, invite redemption, and reset endpoints
  ---
  duration_ms: 1.9979
  ...
# Subtest: admin portal can approve or delete golf-course account requests and sends host approval email guidance
ok 37 - admin portal can approve or delete golf-course account requests and sends host approval email guidance
  ---
  duration_ms: 1.5781
  ...
# Subtest: mysql score storage remains compatible before and after golf-course score columns exist
ok 38 - mysql score storage remains compatible before and after golf-course score columns exist
  ---
  duration_ms: 2.8633
  ...
# Subtest: auth TTL is 24 hours and refreshed on authenticated activity for user, admin, and host sessions
ok 39 - auth TTL is 24 hours and refreshed on authenticated activity for user, admin, and host sessions
  ---
  duration_ms: 1.4607
  ...
# Subtest: expired authenticated sessions redirect to the correct login page and log frontend event data
ok 40 - expired authenticated sessions redirect to the correct login page and log frontend event data
  ---
  duration_ms: 0.7734
  ...
# Subtest: auth TTL migration and port configuration are deployable without hardcoded server ports
ok 41 - auth TTL migration and port configuration are deployable without hardcoded server ports
  ---
  duration_ms: 1.3888
  ...
# Subtest: host portal exposes tournament creation, portal listing, and organizer invite routes
ok 42 - host portal exposes tournament creation, portal listing, and organizer invite routes
  ---
  duration_ms: 0.5826
  ...
# Subtest: organizer invite flow exposes direct auth, portal, eligibility, and public tournament portal endpoints
ok 43 - organizer invite flow exposes direct auth, portal, eligibility, and public tournament portal endpoints
  ---
  duration_ms: 0.4845
  ...
# Subtest: organizer sessions use the same 24-hour sliding TTL pattern as host sessions
ok 44 - organizer sessions use the same 24-hour sliding TTL pattern as host sessions
  ---
  duration_ms: 0.4047
  ...
# Subtest: organizer portal only edits host-invited tournaments and does not create tournaments
ok 45 - organizer portal only edits host-invited tournaments and does not create tournaments
  ---
  duration_ms: 0.8168
  ...
# Subtest: tournament portal lookup accepts host-generated public identifiers as well as ids
ok 46 - tournament portal lookup accepts host-generated public identifiers as well as ids
  ---
  duration_ms: 0.3088
  ...
# Subtest: host portal lets hosts modify every golf-course tournament and exposes published registration URLs
ok 47 - host portal lets hosts modify every golf-course tournament and exposes published registration URLs
  ---
  duration_ms: 0.8956
  ...
# Subtest: published tournament registration uses resolved tournament id for foreign key inserts
ok 48 - published tournament registration uses resolved tournament id for foreign key inserts
  ---
  duration_ms: 0.5856
  ...
# Subtest: host and organizer tournament tiles expose registered golfer counts and details
ok 49 - host and organizer tournament tiles expose registered golfer counts and details
  ---
  duration_ms: 1.0479
  ...
# Subtest: tournament registration sends confirmation email with tournament link
ok 50 - tournament registration sends confirmation email with tournament link
  ---
  duration_ms: 0.6715
  ...
# Subtest: signed-in golfers have a registered tournaments page and API route
ok 51 - signed-in golfers have a registered tournaments page and API route
  ---
  duration_ms: 1.0522
  ...
# Subtest: tournament portal marks already registered golfers and replaces register button with a label
ok 52 - tournament portal marks already registered golfers and replaces register button with a label
  ---
  duration_ms: 0.5505
  ...
# Subtest: server blocks duplicate tournament registration instead of upserting existing rows
ok 53 - server blocks duplicate tournament registration instead of upserting existing rows
  ---
  duration_ms: 1.0774
  ...
# Subtest: tournament registrations migration keeps tournament_id compatible with tournaments id and runs during npm install
ok 54 - tournament registrations migration keeps tournament_id compatible with tournaments id and runs during npm install
  ---
  duration_ms: 1.027
  ...
# Subtest: tournament registration requires two-person or four-person teams and stores team details
ok 55 - tournament registration requires two-person or four-person teams and stores team details
  ---
  duration_ms: 1.1214
  ...
# Subtest: published status controls public tournament visibility and visibility checkbox is removed
ok 56 - published status controls public tournament visibility and visibility checkbox is removed
  ---
  duration_ms: 0.8089
  ...
# Subtest: front-end tournament times are formatted without milliseconds and profile enrichment clears enrich query parameter
ok 57 - front-end tournament times are formatted without milliseconds and profile enrichment clears enrich query parameter
  ---
  duration_ms: 0.6997
  ...
# Subtest: tournament UI supports a single tournament date and clears end date on updates
ok 58 - tournament UI supports a single tournament date and clears end date on updates
  ---
  duration_ms: 1.1042
  ...
# Subtest: front-end dates use friendly user-local month day year time formatting
ok 59 - front-end dates use friendly user-local month day year time formatting
  ---
  duration_ms: 0.8639
  ...
# Subtest: tournament portal includes a close button back to my tournaments
ok 60 - tournament portal includes a close button back to my tournaments
  ---
  duration_ms: 0.279
  ...
# Subtest: tournament flyer template is persisted, editable, and supports organizer-provided imagery and fields
not ok 61 - tournament flyer template is persisted, editable, and supports organizer-provided imagery and fields
  ---
  duration_ms: 4.5929
  location: 'file:///C:/SeanCode/GolfHomiez/golfhomiez/test/app.test.js:825:1'
  failureType: 'testCodeFailure'
  error: |-
    The input did not match the regular expression /readAsDataURL/. Input:
    
    "import { TOURNAMENT_TEMPLATES, emptyTournamentTemplateData, getTournamentTemplate, type TournamentTemplateData } from '../lib/tournament-templates'\n" +
      "import ImageUploadField from './ImageUploadField'\n" +
      "import { compressImageFile } from '../lib/image-upload'\n" +
      '\n' +
      'export type TournamentTemplateFormValue = {\n' +
      '  templateKey?: string | null\n' +
      '  templateBackgroundImageUrl?: string | null\n' +
      '  templateData?: TournamentTemplateData | null\n' +
      '}\n' +
      '\n' +
      'type Props = {\n' +
      '  value: TournamentTemplateFormValue\n' +
      '  onChange: (next: TournamentTemplateFormValue) => void\n' +
      '}\n' +
      '\n' +
      'export default function TournamentTemplateFields({ value, onChange }: Props) {\n' +
      '  const selected = getTournamentTemplate(value.templateKey)\n' +
      '  const templateData = { ...emptyTournamentTemplateData(), ...(value.templateData || {}) }\n' +
      "  const supportingPhotoUrl = templateData.supportingPhotoUrl || ''\n" +
      "  const flyerBackgroundUrl = value.templateBackgroundImageUrl || ''\n" +
      '\n' +
      '  function updateTemplateData(next: Partial<TournamentTemplateData>) {\n' +
      '    onChange({ ...value, templateData: { ...templateData, ...next } })\n' +
      '  }\n' +
      '\n' +
      '  async function onLogoUpload(files?: FileList | null) {\n' +
      '    if (!files?.length) return\n' +
      '    const existing = Array.isArray(templateData.logoFiles) ? templateData.logoFiles : []\n' +
      '    const remainingSlots = Math.max(0, 18 - existing.length)\n' +
      '    const selectedFiles = Array.from(files).slice(0, remainingSlots)\n' +
      '    const encodedFiles = await Promise.all(selectedFiles.map((file) => compressImageFile(file, { maxWidth: 640, maxHeight: 640, quality: 0.72, maxBytes: 120 * 1024, minQuality: 0.45 }).then((result) => result.dataUrl)))\n' +
      '    updateTemplateData({ logoFiles: [...existing, ...encodedFiles].slice(0, 18) })\n' +
      '  }\n' +
      '\n' +
      '  const textFields: Array<[keyof TournamentTemplateData, string, string?]> = [\n' +
      "    ['hostOrganization', 'Host organization'],\n" +
      "    ['beneficiaryCharity', 'Beneficiary/charity'],\n" +
      "    ['checkInTime', 'Check-in time', 'time'],\n" +
      "    ['tournamentFormat', 'Tournament format'],\n" +
      "    ['registrationDeadline', 'Registration deadline', 'date'],\n" +
      "    ['entryFee', 'Entry fee'],\n" +
      "    ['contactPerson', 'Contact person'],\n" +
      "    ['contactPhone', 'Contact phone'],\n" +
      "    ['contactEmail', 'Contact email', 'email'],\n" +
      '  ]\n' +
      '\n' +
      '  return (\n' +
      '    <div className="card" style={{ padding: 16 }}>\n' +
      '      <div style={{ fontWeight: 700 }}>Tournament page design</div>\n' +
      '      <p className="small" style={{ marginTop: 4 }}>Use the clean golf flyer template with uploaded icons for the key tournament attributes. Organizer-uploaded background images are compressed and shown behind the flyer content.</p>\n' +
      `      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12, marginTop: 12 }}>\n` +
      '        {TOURNAMENT_TEMPLATES.map((template) => {\n' +
      '          const checked = (value.templateKey || TOURNAMENT_TEMPLATES[0].key) === template.key\n' +
      '          return (\n' +
      `            <label key={template.key} className="card" style={{ padding: 10, borderColor: checked ? template.accentColor : undefined, cursor: 'pointer' }}>\n` +
      "              <div style={{ minHeight: 170, borderRadius: 12, background: '#fff', border: '1px solid #d1d5db', padding: 14 }}>\n" +
      "                <div style={{ fontWeight: 900, color: template.accentColor, fontSize: 24, textAlign: 'center', textTransform: 'uppercase' }}>Tournament Name</div>\n" +
      '                <div className="formStack" style={{ gap: 6, marginTop: 12 }}>\n' +
      '                  {Object.entries(template.attributeIcons).slice(0, 6).map(([key, icon]) => (\n' +
      "                    <div key={key} style={{ display: 'grid', gridTemplateColumns: '36px 1fr', gap: 8, alignItems: 'center', borderTop: '1px solid #b7d7ad', paddingTop: 5 }}>\n" +
      `                      <img src={icon} alt="" aria-hidden="true" style={{ width: 30, height: 30, objectFit: 'contain' }} />\n` +
      "                      <div style={{ height: 12, background: '#e5efe2', borderRadius: 999 }} />\n" +
      '                    </div>\n' +
      '                  ))}\n' +
      '                </div>\n' +
      '              </div>\n' +
      "              <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 8 }}>\n" +
      '                <input type="radio" name="tournamentTemplate" checked={checked} onChange={() => onChange({ ...value, templateKey: template.key })} />\n' +
      '                <span className="small" style={{ fontWeight: 700 }}>{template.name}</span>\n' +
      '              </div>\n' +
      '              <div className="small">{template.description}</div>\n' +
      '            </label>\n' +
      '          )\n' +
      '        })}\n' +
      '      </div>\n' +
      '\n' +
      '      <ImageUploadField\n' +
      '        label="Flyer background image"\n' +
      '        value={flyerBackgroundUrl}\n' +
      '        emptyText="No flyer background uploaded."\n' +
      '        previewAlt="Selected flyer background preview"\n' +
      "        options={{ maxWidth: 1400, maxHeight: 700, quality: 0.72, maxBytes: 420 * 1024, minQuality: 0.42, correlationData: { usage: 'tournament_flyer_background' } }}\n" +
      '        onChange={(dataUrl) => onChange({ ...value, templateBackgroundImageUrl: dataUrl })}\n' +
      '        onRemove={() => onChange({ ...value, templateBackgroundImageUrl: null })}\n' +
      '      />\n' +
      '\n' +
      '      <ImageUploadField\n' +
      '        label="Supporting photo (optional)"\n' +
      '        value={supportingPhotoUrl}\n' +
      '        emptyText="No supporting photo uploaded."\n' +
      '        previewAlt="Selected supporting photo preview"\n' +
      "        options={{ maxWidth: 1000, maxHeight: 1000, quality: 0.74, maxBytes: 320 * 1024, minQuality: 0.42, correlationData: { usage: 'tournament_supporting_photo' } }}\n" +
      '        onChange={(dataUrl) => updateTemplateData({ supportingPhotoUrl: dataUrl })}\n' +
      "        onRemove={() => updateTemplateData({ supportingPhotoUrl: '' })}\n" +
      '      />\n' +
      '\n' +
      '      <div className="formRow formRow--split" style={{ marginTop: 14 }}>\n' +
      '        <div>\n' +
      '          <label className="label">Tournament Name</label>\n' +
      `          <input className="input" value={templateData.tournamentName || ''} onChange={(e) => updateTemplateData({ tournamentName: e.target.value })} />\n` +
      '        </div>\n' +
      '        {textFields.map(([key, label, type]) => (\n' +
      '          <div key={key}>\n' +
      '            <label className="label">{label}</label>\n' +
      `            <input className="input" type={type || 'text'} value={String(templateData[key] || '')} onChange={(e) => updateTemplateData({ [key]: e.target.value })} />\n` +
      '          </div>\n' +
      '        ))}\n' +
      '      </div>\n' +
      '\n' +
      '      <div style={{ marginTop: 14 }}>\n' +
      '        <label className="label">Shotgun Start or tee times</label>\n' +
      `        <select className="input" value={templateData.startType || 'shotgun'} onChange={(e) => updateTemplateData({ startType: e.target.value })}>\n` +
      '          <option value="shotgun">Shotgun Start</option>\n' +
      '          <option value="tee-times">Tee times</option>\n' +
      '        </select>\n' +
      '      </div>\n' +
      '\n' +
      '      <div className="formRow formRow--split" style={{ marginTop: 14 }}>\n' +
      '        {([\n' +
      "          ['feesInclude', 'What fees include'],\n" +
      "          ['prizeDetails', 'Prize details'],\n" +
      "          ['holeContestsExtras', 'Hole contests/extras'],\n" +
      "          ['miscNotes', 'Misc Notes'],\n" +
      '        ] as Array<[keyof TournamentTemplateData, string]>).map(([key, label]) => (\n' +
      '          <div key={key}>\n' +
      '            <label className="label">{label}</label>\n' +
      `            <textarea className="input" rows={3} value={String(templateData[key] || '')} onChange={(e) => updateTemplateData({ [key]: e.target.value })} />\n` +
      '          </div>\n' +
      '        ))}\n' +
      '      </div>\n' +
      '\n' +
      '      <div style={{ marginTop: 14 }}>\n' +
      '        <label className="label">Logo files (up to 18)</label>\n' +
      `        <input className="input" type="file" accept="image/*" multiple onChange={(e) => { void onLogoUpload(e.target.files); e.currentTarget.value = '' }} />\n` +
      '        <div className="small" style={{ marginTop: 4 }}>{(templateData.logoFiles || []).length} of 18 logos uploaded.</div>\n' +
      '        {templateData.logoFiles?.length ? (\n' +
      `          <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(90px, 1fr))', gap: 8, marginTop: 8 }}>\n` +
      '            {templateData.logoFiles.map((logo, index) => (\n' +
      '              <div key={`${logo.slice(0, 24)}-${index}`} className="card" style={{ padding: 8 }}>\n' +
      "                <img src={logo} alt={`Sponsor logo ${index + 1}`} style={{ width: '100%', height: 50, objectFit: 'contain' }} />\n" +
      `                <button type="button" className="btn" style={{ marginTop: 6, width: '100%' }} onClick={() => updateTemplateData({ logoFiles: (templateData.logoFiles || []).filter((_, logoIndex) => logoIndex !== index) })}>Remove</button>\n` +
      '              </div>\n' +
      '            ))}\n' +
      '          </div>\n' +
      '        ) : null}\n' +
      '      </div>\n' +
      '    </div>\n' +
      '  )\n' +
      '}\n'
    
  code: 'ERR_ASSERTION'
  name: 'AssertionError'
  expected:
  actual: |-
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
    
  operator: 'match'
  stack: |-
    TestContext.<anonymous> (file:///C:/SeanCode/GolfHomiez/golfhomiez/test/app.test.js:856:10)
    Test.runInAsyncScope (node:async_hooks:206:9)
    Test.run (node:internal/test_runner/test:631:25)
    Test.processPendingSubtests (node:internal/test_runner/test:374:18)
    Test.postRun (node:internal/test_runner/test:715:19)
    Test.run (node:internal/test_runner/test:673:12)
    async Test.processPendingSubtests (node:internal/test_runner/test:374:7)
  ...
# Subtest: host tournament creation supports stage schemas without host role assignment ids
ok 62 - host tournament creation supports stage schemas without host role assignment ids
  ---
  duration_ms: 0.2959
  ...
# Subtest: one-time schema rollback is wired into postinstall and removes itself afterward
ok 63 - one-time schema rollback is wired into postinstall and removes itself afterward
  ---
  duration_ms: 2.3997
  ...
# Subtest: rollback migration removes chat-added schema tables and migration records
ok 64 - rollback migration removes chat-added schema tables and migration records
  ---
  duration_ms: 1.6806
  ...
1..64
# tests 64
# suites 0
# pass 63
# fail 1
# cancelled 0
# skipped 0
# todo 0
# duration_ms 245.9828
