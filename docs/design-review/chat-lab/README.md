# Localhost Chat Lab

Run `npm run chat:lab` from the repository root. Keep the app API running on port 3000. Open `http://localhost:8793` on this PC.

## Connect

1. Keep the main account signed in on the phone.
2. Select **Connect Chat Partner** on the website.
3. Refresh Messages on the phone.
4. Open **Chat Partner** once. Return to Messages to inspect previews.
5. Send from either device.

The configured phone account is `Subhankar.Patra2024@iem.edu.in`. Set `CHAT_LAB_PHONE_EMAIL` before starting the server to pair another development account. Set `CHAT_LAB_PORT` to change the website port. The API must use a loopback address; its default is `http://127.0.0.1:3000`.

The helper creates `chatlab.local@iem.edu.in` with a random password held in server memory. It creates one active match with the phone account. It does not change the phone account's profile, password, or verification. The helper account stays paused in Discovery. Existing inactive matches require manual restoration.

## Test controls

- Type text and emojis. Press Enter to send. Press Shift + Enter for a new line.
- Attach up to ten photos or MP4 videos as an album. Send documents and voice files separately.
- Record a voice note in the browser. Stop the recording, then press Send. The browser converts the recording to WAV for the app's media API. The limit is 60 seconds.
- Select a message to reply or react. Select a website message to edit or delete it for both accounts.
- Use sample buttons to send generated media through the normal upload and message API.
- Keep **Confirm delivery automatically** enabled for normal delivery receipts. Disable it before sending from the phone to inspect the sent state.
- Select **Mark delivered**, **Mark read**, or **Mark selected voice as played** to test receipts. Loading the conversation does not mark messages as read. Playing a received voice note reports the actual playback.
- Use **Typing** or **Recording** to show a four-second activity indicator on the phone.

Messages use the real development database and private media storage. Each sample button sends to the paired phone account. Connecting alone does not send a message.

The website uses Socket.IO for live events. It also refreshes visible history every five seconds and refreshes expired access tokens. Tokens remain in browser memory. Reloading the page requires a new connection.

## Checks

Run `node --test scripts/tests/chat-lab.test.cjs` for server routing, upload forwarding, receipt merging, and sample encoding checks.

Run `node scripts/build-chat-lab.cjs` after changing the client source. The server serves the resulting files directly. Restart the Chat Lab server after changing its server code.
