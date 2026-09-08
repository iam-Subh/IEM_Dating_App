import { createHmac, randomUUID, timingSafeEqual, createHash } from "crypto";
import { User } from "@prisma/client";
import { redisClient } from "../utils/redis";
import { HttpError } from "../utils/httpError";
export type Deck = {
  id: string;
  viewer: string;
  ids: string[];
  seed: string;
  expiry: number;
  eligibilityVersion: number;
  configVersion: string;
  algorithm: number;
  exhausted: boolean;
};
export type Cursor = {
  deck: string;
  after: number;
  viewer: string;
  expiry: number;
  version: number;
};
const TTL = 2700;
function secret() {
  const value =
    process.env.DISCOVERY_CURSOR_SECRET || process.env.JWT_ACCESS_SECRET;
  if (!value)
    throw new HttpError(503, "Discovery signing key is not configured");
  return value;
}
export function encodeCursor(value: Cursor): string {
  const body = Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${body}.${createHmac("sha256", secret()).update(body).digest("base64url")}`;
}
export function decodeCursor(token: string, viewer: string): Cursor {
  if (token.length > 2048) throw new HttpError(400, "Invalid cursor");
  const [body, sig, extra] = token.split(".");
  if (!body || !sig || extra) throw new HttpError(400, "Invalid cursor");
  const expected = createHmac("sha256", secret()).update(body).digest();
  const supplied = Buffer.from(sig, "base64url");
  if (
    supplied.length !== expected.length ||
    !timingSafeEqual(expected, supplied)
  )
    throw new HttpError(400, "Invalid cursor");
  let c: Cursor;
  try {
    c = JSON.parse(Buffer.from(body, "base64url").toString());
  } catch {
    throw new HttpError(400, "Invalid cursor");
  }
  if (
    c.viewer !== viewer ||
    !/^[a-f0-9-]{36}$/.test(c.deck) ||
    !Number.isSafeInteger(c.after) ||
    c.after < -1 ||
    !Number.isSafeInteger(c.version) ||
    !Number.isFinite(c.expiry)
  )
    throw new HttpError(400, "Invalid cursor");
  if (c.expiry < Date.now())
    throw new HttpError(409, "Restart discovery", "DECK_EXPIRED");
  return c;
}
// Stable across ranking versions; a new experiment requires an explicit new key.
export const DISCOVERY_EXPERIMENT_KEY = "reco-v2";
export const assignment = (viewer: string) =>
  (createHash("sha256").update(`${DISCOVERY_EXPERIMENT_KEY}:${viewer}`).digest().readUInt32BE(0) /
    0x100000000) *
  100;
export class DeckService {
  static key(viewer: string, id: string) {
    return `deck:v2:{${viewer}}:${id}`;
  }
  static async create(
    me: User,
    configVersion: string,
    algorithm: number,
    generate: (seed: string, excluded: string[]) => Promise<string[]>,
  ) {
    const id = randomUUID(),
      seed = `${me.id}:${id}`;
    const lock = `deck:v2:{${me.id}}:generate`;
    const owner = randomUUID();
    if (!(await redisClient.set(lock, owner, "PX", 30000, "NX")))
      throw new HttpError(
        409,
        "Discovery is updating. Retry shortly.",
        "DECK_BUSY",
      );
    try {
      const ids = [...new Set(await generate(seed, []))].slice(0, 2000);
      const deck: Deck = {
        id,
        viewer: me.id,
        ids,
        seed,
        expiry: Date.now() + TTL * 1000,
        eligibilityVersion: me.eligibilityVersion,
        configVersion,
        algorithm,
        exhausted: ids.length === 0,
      };
      // Publish only while the generation lease still belongs to this request.
      const saved = await redisClient.eval(
        `if redis.call('get',KEYS[1]) ~= ARGV[1] then return 0 end
        redis.call('set',KEYS[2],ARGV[2],'EX',ARGV[3]); redis.call('rpush',KEYS[3],KEYS[2]); redis.call('expire',KEYS[3],ARGV[3]);
        while redis.call('llen',KEYS[3])>2 do local old=redis.call('lpop',KEYS[3]); redis.call('unlink',old) end return 1`,
        3,
        lock,
        this.key(me.id, id),
        `deck:v2:{${me.id}}:active`,
        owner,
        JSON.stringify(deck),
        TTL,
      );
      if (!saved) throw new HttpError(409, "Restart discovery", "DECK_EXPIRED");
      return deck;
    } finally {
      await redisClient.eval(
        `if redis.call('get',KEYS[1]) == ARGV[1] then return redis.call('del',KEYS[1]) end return 0`,
        1,
        lock,
        owner,
      );
    }
  }
  static async load(c: Cursor, me: User, configVersion: string) {
    const raw = await redisClient.get(this.key(me.id, c.deck));
    if (!raw) throw new HttpError(409, "Restart discovery", "DECK_EXPIRED");
    const deck: Deck = JSON.parse(raw);
    if (
      deck.viewer !== me.id ||
      deck.expiry < Date.now() ||
      deck.eligibilityVersion !== me.eligibilityVersion ||
      deck.configVersion !== configVersion ||
      c.version !== me.eligibilityVersion ||
      c.after >= deck.ids.length
    )
      throw new HttpError(409, "Restart discovery", "DECK_EXPIRED");
    return deck;
  }
  static async refill(
    deck: Deck,
    generate: (seed: string, excluded: string[]) => Promise<string[]>,
  ) {
    if (deck.expiry <= Date.now())
      throw new HttpError(409, "Restart discovery", "DECK_EXPIRED");
    if (deck.exhausted || deck.ids.length >= 2000) return deck;
    const key = this.key(deck.viewer, deck.id),
      lock = `${key}:refill`,
      owner = randomUUID();
    if (!(await redisClient.set(lock, owner, "PX", 30000, "NX"))) return deck;
    try {
      const raw = await redisClient.get(key);
      if (!raw) throw new HttpError(409, "Restart discovery", "DECK_EXPIRED");
      const latest: Deck = JSON.parse(raw);
      const ids = await generate(latest.seed, latest.ids);
      const unique = [...new Set(ids)].filter((id) => !latest.ids.includes(id));
      latest.ids.push(...unique.slice(0, 2000 - latest.ids.length));
      latest.exhausted = unique.length === 0;
      const saved = await redisClient.eval(
        `if redis.call('get',KEYS[1]) ~= ARGV[1] or redis.call('exists',KEYS[2]) == 0 then return 0 end redis.call('set',KEYS[2],ARGV[2],'KEEPTTL'); return 1`,
        2,
        lock,
        key,
        owner,
        JSON.stringify(latest),
      );
      if (!saved) throw new HttpError(409, "Restart discovery", "DECK_EXPIRED");
      return latest;
    } finally {
      await redisClient.eval(
        `if redis.call('get',KEYS[1]) == ARGV[1] then return redis.call('del',KEYS[1]) end return 0`,
        1,
        lock,
        owner,
      );
    }
  }
}
