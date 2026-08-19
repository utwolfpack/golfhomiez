import { NavLink } from 'react-router'
import { logFrontendEvent } from '../lib/frontend-logger'

type GolfCoursePublicNavProps = {
  slug: string
  golfCourseName: string
  calendarAvailable: boolean
}

export default function GolfCoursePublicNav({ slug, golfCourseName, calendarAvailable }: GolfCoursePublicNavProps) {
  const coursePath = `/${slug}`
  const calendarPath = `${coursePath}/calendar`

  return (
    <nav className="golfCoursePublicNav" aria-label={`${golfCourseName} navigation`}>
      <NavLink
        end
        className={({ isActive }) => `golfCoursePublicNavLink${isActive ? ' golfCoursePublicNavLink--active' : ''}`}
        to={coursePath}
        onClick={() => logFrontendEvent({ category: 'golf-course.public-nav', message: 'course_home_selected', data: { slug } })}
      >
        Course Home
      </NavLink>
      {calendarAvailable ? (
        <NavLink
          className={({ isActive }) => `golfCoursePublicNavLink${isActive ? ' golfCoursePublicNavLink--active' : ''}`}
          to={calendarPath}
          onClick={() => logFrontendEvent({ category: 'golf-course.public-nav', message: 'tournament_calendar_selected', data: { slug } })}
        >
          Tournament Calendar
        </NavLink>
      ) : null}
    </nav>
  )
}
