# Chat service recovery review

Date: 2026-09-08

The recovered TypeScript service contains all 15 methods. This review found and corrected four behavior gaps.

| Gap | Correction |
| --- | --- |
| Invalid reaction escape sequences | Restore the six supported emoji characters. |
| Equivalent attachment retries produced different fingerprints | Sort attachment keys and normalize the default message type before hashing. |
| Special metadata keys could disappear during canonicalization | Build canonical objects with a null prototype so `__proto__` remains a data key. |
| A message could be deleted after the initial edit lookup | Check deletion again inside the edit transaction after acquiring the lock. |

Four regression tests cover these corrections in `apps/api/tests/chat-stories.integration.test.ts`.

The existing receipt corrections remain present. Partial reads recount unread messages. Receipt sequence values cannot decrease. Read receipts preserve an earlier delivery timestamp. Read queries exclude deleted and hidden messages.

## Validation

- The full API test command passed against isolated local PostgreSQL and Redis services.
- The chat/Story integration suite passed all 16 tests, including the four new tests.
- The chat regression suite passed all 17 tests.
- API, API-tools, and mobile TypeScript checks passed.
- The chat service diff passed the whitespace check.

This verifies the tested behavior. It does not prove that the recovered file matches every historical edit. Physical-device testing and the remaining authentication audit retain their separate scope.
