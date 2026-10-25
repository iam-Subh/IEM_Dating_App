import { test } from 'node:test';
import assert from 'node:assert/strict';
import { maskIp } from '../src/services/session-network';

test('local connections have a readable label instead of a shortened IPv6 value', () => {
  for (const address of ['::1', '0:0:0:0:0:0:0:1', '127.0.0.1', '::ffff:127.0.0.1']) {
    assert.equal(maskIp(address), 'Local connection');
  }
});

test('public network values preserve the prefix and keep the remaining address masked', () => {
  assert.equal(maskIp('103.21.42.99'), '103.21.x.x');
  assert.equal(maskIp('::ffff:103.21.42.99'), '103.21.x.x');
  assert.equal(maskIp('2401:4900:1234:5678:abcd:ef01:2345:6789'), '2401:4900:x:x:x:x:x:x');
  assert.equal(maskIp('2001::1234'), '2001:0:x:x:x:x:x:x');
  assert.equal(maskIp('::abcd:1234:5678:9abc:def0:1234:5678'), '0:abcd:x:x:x:x:x:x');
});

test('missing and invalid network values do not produce misleading labels', () => {
  for (const address of [undefined, '', ' ', 'invalid', '1:…', '999.1.2.3']) assert.equal(maskIp(address), null);
});
