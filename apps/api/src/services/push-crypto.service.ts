import crypto from 'crypto';

/**
 * Encrypted chat pushes (apps/mobile/src/features/notifications/MESSAGE_NOTIFICATIONS_PLAN.md 11):
 * each phone makes its own 256-bit key and gives it to the server over HTTPS
 * when it registers. Chat pushes to that phone are AES-256-GCM encrypted with
 * it, so Google's servers carry only `{ type: "enc", iv, ct }` - no names, no
 * text, no picture links, even with previews on.
 *
 * The keys are kept sealed in the database with a key derived from the
 * server's secret, so a database copy alone can't read pushes.
 */

function sealingKey() {
  const secret = process.env.PUSH_KEY_SECRET || process.env.JWT_ACCESS_SECRET;
  if (!secret) throw new Error('PUSH_KEY_SECRET or JWT_ACCESS_SECRET must be set');
  return crypto.createHash('sha256').update(`push-key:${secret}`).digest();
}

/** A phone's key as it arrives: base64 of exactly 32 bytes, or null. */
export function parsePhoneKey(value: string | undefined | null): Buffer | null {
  if (!value || !/^[A-Za-z0-9+/]{43}=$/.test(value)) return null;
  const key = Buffer.from(value, 'base64');
  return key.length === 32 ? key : null;
}

export function sealPhoneKey(key: Buffer): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', sealingKey(), iv);
  const body = Buffer.concat([cipher.update(key), cipher.final(), cipher.getAuthTag()]);
  return `v1.${iv.toString('base64')}.${body.toString('base64')}`;
}

export function openPhoneKey(sealed: string | null | undefined): Buffer | null {
  if (!sealed?.startsWith('v1.')) return null;
  try {
    const [, ivText, bodyText] = sealed.split('.');
    const body = Buffer.from(bodyText, 'base64');
    const decipher = crypto.createDecipheriv('aes-256-gcm', sealingKey(), Buffer.from(ivText, 'base64'));
    decipher.setAuthTag(body.subarray(body.length - 16));
    return Buffer.concat([decipher.update(body.subarray(0, body.length - 16)), decipher.final()]);
  } catch {
    return null;
  }
}

/** The push's data, encrypted for one phone: ciphertext followed by the 16-byte tag, as the phone expects. */
export function encryptForPhone(key: Buffer, data: Record<string, unknown>) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const body = Buffer.concat([cipher.update(JSON.stringify(data), 'utf8'), cipher.final(), cipher.getAuthTag()]);
  return { type: 'enc', v: 1, iv: iv.toString('base64'), ct: body.toString('base64') };
}
