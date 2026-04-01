This patch fixes the build error by restoring the named export expected by:
- src/components/UseMyLocationButton.tsx

Changed file:
- src/lib/locations.ts

What changed:
- added export async function resolveMyLocationFromBrowser()
- kept backend-only location lookup flow
- preserved searchLocations() and getNearestLocation()

Why build failed:
- UseMyLocationButton imports resolveMyLocationFromBrowser
- src/lib/locations.ts no longer exported it
- Rollup/Vite failed during production build
