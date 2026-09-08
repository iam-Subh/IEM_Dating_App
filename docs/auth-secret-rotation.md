# Authentication secret rotation

Use this procedure before a beta or production release if the environment could have run with a fallback JWT secret.

1. Stop public traffic to the old API instances.
2. Generate two independent random secrets. Each secret must contain at least 32 characters.
3. Set `JWT_ACCESS_SECRET` and `JWT_REFRESH_SECRET` in the environment secret manager. Do not store the values in Git.
4. Deploy the new API code and the `session_version` migration.
5. Set `CONFIRM_REVOKE_ALL_SESSIONS=REVOKE` in an administrative shell.
6. Run `npm run auth:revoke-all-sessions` from the API workspace.
7. Remove `CONFIRM_REVOKE_ALL_SESSIONS` from the shell.
8. Restart all API and Socket.IO instances with the new secrets.
9. Confirm that an old access token, an old refresh token, and an existing socket all fail.
10. Confirm that a new login creates a 30-day session and a valid 15-minute access token.

The command deletes all stored sessions and increments every user's `sessionVersion` in one database transaction. The command does not change environment secrets. Rotate the secrets before running it.
