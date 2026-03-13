# Golf Homiez! Tracker (Local React App)

This project runs locally with a React (Vite) client and a small Express API that writes data to **static JSON files inside the repo**.

## What’s included
- Identity management
  - Registration page (email + password) -> stored in `server/data/users.json`
  - Login page (username + password; username == email) -> returns a JWT stored in LocalStorage
- Global navigation menu
- Home dashboard
  - Filters: course + team
  - Calculations: winning % and money won/lost (based on filters)
- Directions page
- Golf Logger page
  - Log rounds and append to `server/data/scores.json`
  - Optional 18-hole entry (future-friendly)

## Run locally
1. Install dependencies:
```bash
npm install
```

2. Start client + server:
```bash
npm run dev
```

- Client: http://localhost:5173
- API: http://localhost:5000

## Data files
- Users: `server/data/users.json`
- Scores: `server/data/scores.json`

> Note: This is for local use. Storing credentials in a repo file is not suitable for production.


## MySQL migration (CloudPanel)

This app now uses MySQL/MariaDB instead of JSON files for runtime storage.

1. Create a database and database user in CloudPanel. CloudPanel supports adding a database and user from the Databases screen. citeturn0search1turn0search5
2. Copy `.env.mysql.example` values into your environment or CloudPanel Node.js site variables.
3. Install dependencies: `npm install`
4. Build the frontend: `npm run build`
5. Migrate the current JSON data into MySQL: `npm run migrate:mysql`
6. Start the app: `npm start`

The migration reads the existing JSON files from `server/data/` (or `DATA_DIR` if you set it) and imports them into MySQL tables.
