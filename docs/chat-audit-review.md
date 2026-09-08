# Review of the supplied chat audit

The supplied report contains 12 numbered findings, not 11. Its findings are mostly valid. Its test totals are historical claims, not proof of the current workspace.

| Item | Assessment |
|---|---|
| 1 | Valid expiry problem. It occurs on an event after token expiry, not necessarily exactly 15 minutes after connection. Established connections still require session expiry and revocation checks. |
| 2 | Valid initialization race. Awaiting room joins before registering handlers can also lose early client events. Register handlers synchronously and wait for initialization in packet middleware. Corrected. |
| 3 | Reasonable timeout adjustment. A short timeout increases mobile disconnect risk; the interval/timeout ratio alone does not prove a bug. |
| 4 | Valid. Stable failure codes let clients distinguish transient and permanent failures. |
| 5 | Valid for object-key ordering. Array ordering can be meaningful. The current attachment fingerprint treats attachment keys as a set. Canonical objects now use a null prototype to preserve special property names. |
| 6 | Valid cursor convergence problem. The fix also needed a captured high-water bound before querying events to avoid skipping concurrent commits. Corrected. |
| 7 | Cleanup reduces orphan storage. Immediate deletion is not itself a universal requirement. Temporary storage failures must remain retryable. |
| 8 | Valid queue-blocking problem, but silent deletion after five failures loses drafts. Preserve a failed queue record, stop automatic retries for it, and notify the user. Corrected. A dedicated failed-draft recovery screen remains open. |
| 9 | Valid ordering problem. The preview comparison omitted its sequence and ranked it as pending, preventing updates. Added date fallback for legacy previews. Corrected. |
| 10 | Valid. Match by client message ID. Also replace temporary IDs with server IDs so edits, reactions, deletion, and receipts can find confirmed messages. Corrected. |
| 11 | Preserve the first valid read timestamp. Duplicate later receipts must not replace it. The report's wording about moving time backwards is inconsistent with its test, which accepts an earlier first-read timestamp. |
| 12 | Typing expiry is valid. A join acknowledgement must indicate success. A timeout or rejection is not successful admission. Corrected the reconnect check. |

## Additional corrections

Edited-message replay excludes bodies hidden by the requesting user. Session generation also changes when access credentials are cleared without changing the user object. This invalidates stale requests in that transition.

## Limits

The audit does not prove complete chat security. Receiving-only socket revocation, concurrent block/unmatch races, interrupted media processing, failed-draft recovery, presigned upload size enforcement, and signed-device tests remain open. A 10-minute cache freshness setting inside a 15-minute URL lifetime does not establish immediate access revocation or guarantee cache refresh behavior.

The current verification runs include 17 chat regression tests, seven mobile queue/socket tests, and three authentication isolation tests. Tests use the disposable local PostgreSQL and Redis services where required.
