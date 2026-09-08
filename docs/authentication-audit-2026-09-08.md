# Authentication audit: HTTP retries

## Corrections

- A delayed HTTP 401 response could start another refresh after a concurrent request had already rotated the access token. The interceptor now retries once with the current token. The existing session check prevents retries after an account switch.
- A request with a supplied Authorization header could retain that header when the store had no token. The interceptor now removes that header when the user is logged out.

## Validation

Five authentication tests and seven chat queue/socket tests passed. The mobile TypeScript check passed. The new retry test checks the authorization header used by the retry and rejects any unnecessary refresh call.

Existing tests also check late refresh responses after account switching, pending HTTP responses after logout, network failures during refresh, and socket disconnection after logout.

## Remaining scope

Physical-device lifecycle tests and the cross-account backend route audit remain separate work. These checks do not establish complete authentication coverage.

## Logout cleanup pass

The Settings logout flow now clears local access without waiting for the server or storage. It starts queue and credential cleanup before clearing the account state. A storage failure does not prevent socket disconnection or private state removal.

The server logout request uses the captured access token through a separate request without automatic token refresh. Its completion cannot clear a later account. The screen reports incomplete server or storage cleanup. Account deletion uses the same local cleanup function after the server accepts the deletion request.

Seven authentication tests passed, including two new logout tests. The mobile TypeScript check passed. The tests cover a delayed server reply after account switching and a queue storage failure during logout.

Failed server revocation can leave the server session active. Failed storage deletion can leave stored data on the device. The app reports these failures; this change does not claim that failed cleanup succeeded.

## Cleanup retry pass

Server logout retries network failures, HTTP 429, and server errors up to three attempts. Each attempt uses the original token. It does not retry authentication failures with a new account's credentials.

Queue deletion and credential deletion also use up to three attempts. Credential retries run inside the credential mutation queue, before a later login can write its token. Queue deletion retains the original account key.

Credential cleanup writes a persistent logout marker separately from secure token deletion. Credential reads reject an old token when this marker exists, including after restart. A successful new credential write clears the marker. If marker storage cannot be read, credential reads fail rather than restore a session.

Validation: 11 authentication tests and seven chat tests passed. Mobile TypeScript checks passed. Tests cover restart after failed secure deletion, transient deletion failure, later login isolation, bounded network retries, and persistent network failure.

No client can guarantee server revocation without a working connection. If all retries fail, the app still reports incomplete cleanup. If both storage systems fail, the client cannot guarantee persistent cleanup across a restart. These failures are not reported as successful logout cleanup.
