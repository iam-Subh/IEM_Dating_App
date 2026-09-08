# Chat bug audit

## Authentication isolation pass

HTTP requests now retain a session-generation key. Reject responses and retries after logout or account switching. Scope shared refresh work to that session. Reject stale refresh results before credential rotation and access-token dispatch.

Credential writes and deletion run in order. Refresh rotation checks the expected stored token and current session. A temporary network or server failure during refresh no longer deletes credentials, queues, or cached state. Authentication rejection still triggers session cleanup.

Validation: `npm run test:auth --workspace apps/mobile` passed three session-race tests. The six queue/socket tests and mobile TypeScript check passed. These tests use controlled dependencies; they do not replace device tests or a full authentication audit.

Date: 8 September 2026

## Confirmed corrections

| Area | Bug | Correction |
|---|---|---|
| Read receipts | Reading a subset reset the full unread count. | Count the remaining visible unread messages in the receipt transaction. |
| Receipt progress | An older batch reduced the stored read or delivery sequence. | Preserve the greater sequence while holding the conversation lock. |
| Delivery time | Reading a message replaced its earlier delivery timestamp. | Set delivery time only when it is absent. |
| Read visibility | Hidden or deleted messages could receive read receipts. | Exclude hidden and deleted messages from the read update. |
| Message editing | A concurrent deletion could occur between the initial check and the edit transaction. | Recheck deletion after acquiring the conversation lock. |
| Offline storage | An account switch during a storage operation could change its destination key. | Capture the account key before queuing the operation. |
| Retry callbacks | A late or previous-account acknowledgement could update current UI state. | Ignore callbacks after timeout or account change. |
| Retry order | Later queued messages continued after an earlier failure. | Stop the retry batch at its first unconfirmed message. |
| Message search | A stale response could replace the latest search results. | Abort obsolete requests and guard response state updates. |
| Search failures | Rejected requests had no error state. | Show loading, empty, and error states separately. Limit input to 100 characters. |

## Regression checks

Run mobile queue tests from the repository root:

```powershell
npm run test:chat --workspace apps/mobile
npm run typecheck --workspace apps/mobile
npm run typecheck --workspace apps/api
```

Run `test:chat-stories` only with the isolated PostgreSQL and Redis configuration from `chat-stories-search-implementation.md`. The suite clears its test data.

The first audit pass verified three mobile queue tests and ten chat/Story integration tests. These checks do not prove that every chat defect is resolved.

## Audit scope still open

## Second pass: sockets and replay

- Preserve the socket instance during reconnect so screen listeners remain attached.
- Read current credentials at each handshake. Reconnect the same instance when Redux receives a refreshed access token.
- Disconnect immediately when Redux clears credentials or switches accounts.
- Listen for reconnect attempts on the Socket.IO manager.
- Cancel delayed retry tasks when the chat screen effect closes.
- Replace optimistic messages after successful offline retries.
- Ignore messages for other conversation rooms. Match optimistic sends by client message ID instead of text.
- Include currently visible message content in message-created replay events. Exclude hidden and deleted bodies.
- Serialize replay requests. Treat live chat events as replay triggers so out-of-order events cannot advance the replay cursor past missing events.
- Apply replay on initial synchronization and continue through all available pages.

Validation: six mobile queue/socket tests and eleven chat/Story integration tests passed. API and mobile TypeScript checks passed. Socket tests use a fake transport; physical-device evidence remains required.

## Remaining audit scope

## Third pass: upload completion failures

- Validate the private bucket configuration before creating an upload ticket.
- Restore the requested state when object metadata or signature reads fail. Return `MEDIA_STORAGE_UNAVAILABLE` with HTTP 503.
- Return `MEDIA_UPLOAD_MISSING` with HTTP 409 when the object has not arrived. Keep completion retryable until ticket expiry.
- Continue to reject invalid file contents. A failed signature read is distinct from an invalid signature.
- Preserve the completed-asset retry path without requiring an object-store call.

Validation: twelve chat/Story integration tests passed. Tests simulate storage timeouts, missing objects, invalid signatures, missing bucket configuration, and completion by another account. Upload-ticket, completion, and new read-grant requests fail after unmatch. API and API-tools TypeScript checks passed.

This pass does not implement automatic mobile completion retries. Processing-worker crash recovery, concurrent revocation during processing, and already-issued signed URL expiry remain open. Existing signed URLs can remain usable until their 15-minute expiry.

Continue review of socket authentication refresh, reconnect event application, media upload failure handling, conversation pagination, concurrent access revocation, and physical-device lifecycle behavior. Test each confirmed defect before claiming complete chat validation. The earlier statement that no source work remained was too broad.
