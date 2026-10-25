# Chat message actions

## Behavior

- Text send clears the draft immediately. A server acknowledgement does not lock the next draft. Each send has a distinct client command ID. A frame guard rejects duplicate taps on the same draft.
- Media upload keeps its existing upload guard.
- Hold a delivered message to open the anchored action menu. The reaction row stays above the menu. The menu position is bounded by the window and safe-area insets.
- Reply, Forward, Copy, Star, Pin, Edit (sender), Report (recipient), and Delete use existing or new application operations.
- Star is private to the authenticated user. Pin is shared by the match participants. The header menu opens bounded lists of starred and pinned messages.
- Forward selects an accessible conversation. Media is downloaded through the authorized read API and uploaded as a new destination-owned asset. A retry reuses its prepared media and command ID while the picker remains open.
- Delete defaults to removal for the current user. The optional checkbox requests deletion for both participants. The server keeps its existing sender-only, 15-minute restriction.
- Emoji, attachment, and voice/send controls remain at the bottom of a multiline composer.

## Deployment

Apply `202609110001_message_marks` before enabling the new Star and Pin actions against a server. Deploy the API routes with the mobile changes. The migration creates a separate table and does not rewrite messages.

This change was migrated and tested on the isolated local database. The configured cloud database was not changed.

## Verification

Run mobile and API typechecks, the mobile chat tests, and the API chat regression suite with the isolated database configuration in `chat-stories-search-implementation.md`. New server cases cover private stars, shared pins, hidden-message exclusion, outsider rejection, and concurrent idempotent sends.

Device verification must cover keyboard open/close, multiline entry, rapid sends, menu placement at both screen edges, and forwarding media. Code checks do not establish pixel-identical rendering or device animation performance.
