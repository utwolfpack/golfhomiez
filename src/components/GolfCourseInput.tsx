import { useMemo } from 'react'
import { useGolfCourseOptions } from '../hooks/useGolfCourseOptions'

export default function GolfCourseInput({
  label = 'Golf course',
  value,
  onChange,
  state,
  placeholder = 'Start typing a course…',
  disabled = false,
  helperText,
  datalistId,
}: {
  label?: string
  value: string
  onChange: (next: string) => void
  state?: string
  placeholder?: string
  disabled?: boolean
  helperText?: string | null
  datalistId: string
}) {
  const { courses, loading, error } = useGolfCourseOptions({
    state,
    query: value,
    enabled: !disabled,
    limit: state ? 75 : 20,
  })

  const options = useMemo(() => {
    const seen = new Set<string>()
    return courses.filter((course) => {
      const key = `${course.state}::${course.name}`.toLowerCase()
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
  }, [courses])

  return (
    <div>
      <label className="label">{label}</label>
      <input className="input" list={datalistId} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} disabled={disabled} />
      <datalist id={datalistId}>
        {options.map((course) => (
          <option key={`${course.id}-${course.name}`} value={course.name}>{course.label}</option>
        ))}
      </datalist>
      {helperText ? <div className="small" style={{ marginTop: 6 }}>{helperText}</div> : null}
      {!helperText && loading ? <div className="small" style={{ marginTop: 6 }}>Loading golf courses…</div> : null}
      {!helperText && !loading && error ? <div className="small" style={{ marginTop: 6, color: '#b91c1c' }}>{error}</div> : null}
    </div>
  )
}
