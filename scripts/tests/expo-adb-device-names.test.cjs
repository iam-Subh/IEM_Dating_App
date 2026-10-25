const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');

const filename = path.resolve(__dirname, '../../node_modules/@expo/cli/build/src/start/platforms/android/adb.js');
const nativeRequire = createRequire(filename);

test('Expo preserves wireless device IDs with spaces and parses USB and offline devices', async () => {
  const lines = [
    'List of devices attached',
    'adb-phone (2)._adb-tls-connect._tcp device product:phone model:CPH2643 device:phone transport_id:60',
    'adb-phone (3)._adb-tls-connect._tcp device product:phone model:CPH2643 device:phone transport_id:61',
    'adb-phone._adb-tls-connect._tcp device product:phone model:CPH2643 device:phone transport_id:59',
    'USB123\tdevice usb:1-1 product:phone model:Pixel_9 device:phone',
    'USB456\toffline transport_id:62',
    'USB789\tunauthorized usb:1-2 transport_id:63',
  ].join(require('node:os').EOL);
  const exports = {};
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
    exports,
    require: name => name === './ADBServer' ? { ADBServer: class { async runAsync() { return lines; } } } : nativeRequire(name),
  });
  const devices = await exports.getAttachedDevicesAsync();
  assert.deepEqual(Array.from(devices, device => device.pid), [
    'adb-phone (2)._adb-tls-connect._tcp', 'adb-phone (3)._adb-tls-connect._tcp',
    'adb-phone._adb-tls-connect._tcp', 'USB123', 'USB456', 'USB789',
  ]);
  assert.equal(devices[0].connectionType, 'Network');
  assert.equal(devices[0].isAuthorized, true);
  assert.equal(devices[3].connectionType, 'USB');
  assert.equal(devices[4].isBooted, false);
  assert.equal(devices[5].isAuthorized, false);
});
