import { isIP } from 'node:net';

/** Show a readable network prefix without exposing the complete public address. */
export function maskIp(ip: string | undefined): string | null {
  const address = ip?.trim().replace(/^::ffff:/i, '');
  if (!address) return null;
  const family = isIP(address);
  if (!family) return null;
  if (family === 4) {
    const parts = address.split('.');
    if (parts[0] === '127') return 'Local connection';
    return `${parts[0]}.${parts[1]}.x.x`;
  }
  const [start, end] = address.split('::');
  const head = start.split(':').filter(Boolean);
  const tail = (end ?? '').split(':').filter(Boolean);
  const missing = 8 - head.length - tail.length - (tail.some(part => part.includes('.')) ? 1 : 0);
  const groups = end === undefined ? head : [...head, ...Array(missing).fill('0'), ...tail];
  if (groups.slice(0, 7).every(group => parseInt(group, 16) === 0) && parseInt(groups[7], 16) === 1) return 'Local connection';
  return `${groups.slice(0, 2).join(':')}:x:x:x:x:x:x`;
}
