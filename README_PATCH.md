Included files
- src/pages/Home.tsx
- src/pages/MyGolfScores.tsx
- src/components/StatCard.tsx
- src/components/RoundDetailModal.tsx
- src/lib/roundInsights.js
- src/index.css
- test/app.test.js

Validation run
- npm test ✅
- Production build was not completed in the container because this uploaded project is missing Rollup's native optional dependency and has a non-executable local vite binary in node_modules/.bin. Reinstalling dependencies on the deployment machine should resolve it:
  rm -rf node_modules package-lock.json
  npm install
  npm run build
