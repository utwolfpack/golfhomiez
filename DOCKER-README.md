# Docker files for Golf Homiez Tracker

These files are meant to be copied into the **root of the app project**.

## Quick start

1. Unzip the app archive.
2. Unzip this Docker archive into the same app folder so these files sit next to `package.json`.
3. Run:
   ```bash
   docker compose up --build
   ```
4. Open:
   - App/API: `http://localhost:5001`

## Notes

- The app container connects to the MySQL container using `DB_HOST=mysql`.
- MySQL data is stored in the named Docker volume `mysql_data`.
- The server creates tables automatically on startup.
- To import the JSON seed data after the stack is running:
  ```bash
  docker compose exec app npm run migrate:mysql
  ```

## CloudPanel

These Docker files are for local use only. On Hostinger CloudPanel, deploy the app normally as a Node.js app with MySQL environment variables and run:

```bash
npm install
npm run build
npm start
```
