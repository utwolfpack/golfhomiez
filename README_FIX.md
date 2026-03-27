This patch fixes the MySQL parse error caused by using parameter placeholders for table metadata checks.

Root cause:
- MySQL prepared statement placeholders (`?`) cannot safely stand in for identifiers such as table names in statements like `DESCRIBE ?`, `SHOW COLUMNS FROM ?`, or `SELECT ... FROM ?`.
- The replacement file uses `INFORMATION_SCHEMA.TABLES` and `INFORMATION_SCHEMA.COLUMNS` for existence checks, and only interpolates a table name after it has been validated against known candidates (`user`, `users`).

File to replace:
- `server/lib/app-user-sync.js`

How to apply:
1. Back up your current `server/lib/app-user-sync.js`.
2. Replace it with the file from this zip.
3. Restart the server.

Notes:
- This patch assumes Better Auth uses either a `user` or `users` table.
- If your local schema uses a different auth user table name, add it to the `candidates` array in `getBetterAuthUserTable()`.
