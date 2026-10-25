/**
 * A chat client in the terminal, so you can talk to the phone as a second
 * person without a second device or an emulator.
 *
 *   npx tsx scripts/chat-cli.ts
 *
 * It signs in over the real HTTP API, opens a real Socket.IO connection and
 * joins the real match room - the same path the app takes. Nothing is stubbed,
 * so what you see here is what the phone sees.
 *
 * Type a line and press enter to send. Commands:
 *   /read     mark everything from the other side as read
 *   /typing   send a typing indicator for a few seconds
 *   /history  reprint the last 20 messages
 *   /quit     exit
 */
import { io, Socket } from 'socket.io-client';
import readline from 'readline';
import { randomUUID } from 'crypto';

const API = process.env.CHAT_CLI_API ?? 'http://127.0.0.1:3000/api/v1';
const SOCKET = process.env.CHAT_CLI_SOCKET ?? 'http://127.0.0.1:3000';
const EMAIL = process.env.CHAT_CLI_EMAIL ?? 'chatpartner@iem.edu.in';
const PASSWORD = process.env.CHAT_CLI_PASSWORD ?? 'password123';

const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;
const them = (s: string) => `\x1b[36m${s}\x1b[0m`;
const mine = (s: string) => `\x1b[32m${s}\x1b[0m`;
const warn = (s: string) => `\x1b[33m${s}\x1b[0m`;

function stamp() {
  return dim(new Date().toLocaleTimeString());
}

async function api(path: string, init: RequestInit & { token?: string } = {}) {
  const { token, ...rest } = init;
  const res = await fetch(API + path, {
    ...rest,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: 'Bearer ' + token } : {}),
      ...(rest.headers ?? {}),
    },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`${path} -> ${res.status} ${JSON.stringify(body)}`);
  }
  return body as any;
}

async function main() {
  console.log(dim(`connecting to ${API} as ${EMAIL}`));

  const login = await api('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  const token: string = login.data.accessToken;
  const meId: string = login.data.user.id;
  console.log(dim(`signed in as ${login.data.user.name}`));

  const convos = await api('/chat/conversations', { token });
  const list: any[] = convos.data?.items ?? [];
  if (list.length === 0) {
    console.error(warn('No conversations. Run scripts/setup-chat-partner.ts first to create the match.'));
    process.exitCode = 1;
    return;
  }
  const convo = list[0];
  const matchId: string = convo.matchId;
  console.log(dim(`talking to ${convo.user?.name ?? 'unknown'}  (match ${matchId})`));

  const history = await api(`/chat/${matchId}/messages?limit=20`, { token });
  const past: any[] = (history.data?.messages ?? history.data ?? []).slice().reverse();
  for (const m of past) {
    const who = m.senderId === meId ? mine('you') : them(convo.user?.name ?? 'them');
    console.log(`${stamp()} ${who}: ${m.content}`);
  }

  const socket: Socket = io(SOCKET, {
    auth: { token },
    transports: ['websocket'],
  });

  socket.on('connect', () => {
    console.log(dim('socket connected'));
    socket.emit('join_match_room', matchId, (ack: any) => {
      if (ack && ack.success === false) console.log(warn('join failed: ' + JSON.stringify(ack)));
    });
  });

  socket.on('connect_error', (e) => console.log(warn('socket error: ' + e.message)));
  socket.on('disconnect', (reason) => console.log(warn('socket disconnected: ' + reason)));

  socket.on('new_message', (msg: any) => {
    if (msg.matchId && msg.matchId !== matchId) return;
    if (msg.senderId === meId) return; // our own echo
    console.log(`${stamp()} ${them(convo.user?.name ?? 'them')}: ${msg.content}`);
    // Behave like a real client so the phone's ticks update.
    socket.emit('messages_delivered', { matchId, messageIds: [msg.id] });
    socket.emit('message_read', { matchId, messageIds: [msg.id] });
  });

  socket.on('typing_start', (d: any) => {
    if (d.senderId !== meId) process.stdout.write(dim(`  ${convo.user?.name ?? 'they'} are typing...\n`));
  });
  socket.on('messages_read', (d: any) => {
    if (d.readBy !== meId) console.log(dim('  (they read your messages)'));
  });
  socket.on('chat_event', (e: any) => console.log(dim('  event: ' + (e.type ?? JSON.stringify(e)))));

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, prompt: '> ' });
  rl.prompt();

  rl.on('line', (raw) => {
    const line = raw.trim();
    if (!line) return rl.prompt();

    if (line === '/quit') { rl.close(); return; }
    if (line === '/typing') {
      socket.emit('typing_start', { matchId });
      setTimeout(() => socket.emit('typing_stop', { matchId }), 3000);
      console.log(dim('  sent typing indicator'));
      return rl.prompt();
    }
    if (line === '/read') {
      socket.emit('message_read', { matchId });
      console.log(dim('  marked as read'));
      return rl.prompt();
    }
    if (line === '/history') {
      api(`/chat/${matchId}/messages?limit=20`, { token })
        .then((h) => {
          const msgs: any[] = (h.data?.messages ?? h.data ?? []).slice().reverse();
          for (const m of msgs) {
            const who = m.senderId === meId ? mine('you') : them(convo.user?.name ?? 'them');
            console.log(`${stamp()} ${who}: ${m.content}`);
          }
        })
        .catch((e) => console.log(warn(e.message)))
        .finally(() => rl.prompt());
      return;
    }

    socket.emit(
      'send_message',
      { matchId, content: line, clientMessageId: randomUUID() },
      (ack: any) => {
        if (ack && ack.success === false) {
          console.log(warn(`  not sent: ${ack.code ?? ''} ${ack.message ?? JSON.stringify(ack)}`));
        } else {
          console.log(`${stamp()} ${mine('you')}: ${line}`);
        }
        rl.prompt();
      },
    );
  });

  // Exit by closing what keeps the process alive, never process.exit(): on
  // Windows, exiting while fetch's connections are still closing aborts Node
  // with "Assertion failed: !(handle->flags & UV_HANDLE_CLOSING)".
  rl.on('close', () => {
    socket.close();
    console.log(dim('\nbye'));
  });
}

main().catch((e) => {
  console.error(warn('failed: ' + e.message));
  if (/\/auth\/login -> 401/.test(e.message)) {
    console.error(warn(`No account ${EMAIL} with that password. Create it with: npx tsx apps/api/scripts/setup-chat-partner.ts <your email>`));
  }
  process.exitCode = 1;
});
