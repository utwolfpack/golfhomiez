import {
  __resetGolfbertClientCachesForTests,
  formatGolfbertPhysicalAddress,
  resolveGolfbertCourse,
  searchGolfbertCourses,
} from './golfbert-client.js'

function normalizeState(value) {
  return String(value || '').replace(/\s+/g, ' ').trim().toUpperCase()
}

export async function listGolfCoursesForState(state, options = {}) {
  return searchGolfbertCourses({
    state: normalizeState(state),
    query: options.query || options.q || '',
  })
}

export async function listGolfCourseNamesByState(state, options = {}) {
  const courses = await listGolfCoursesForState(state, options)
  return courses.map((course) => course.name)
}

export async function resolveGolfCourseForState(state, courseName) {
  return resolveGolfbertCourse({ state: normalizeState(state), courseName })
}

export async function findGolfCourseForState(state, courseName) {
  return resolveGolfCourseForState(state, courseName)
}

export async function getGolfCourseByName(courseName, state = '') {
  return resolveGolfbertCourse({ state: normalizeState(state), courseName })
}

export function formatGolfCoursePhysicalAddress(course) {
  return formatGolfbertPhysicalAddress(course)
}

export function __resetGolfCourseServiceCachesForTests() {
  __resetGolfbertClientCachesForTests()
}
