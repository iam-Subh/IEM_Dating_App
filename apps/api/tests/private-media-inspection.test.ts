import assert from 'node:assert/strict';
import test from 'node:test';
import { detectPrivateMediaType } from '../src/services/private-media-inspection.service';

function signature(value: string, offset = 0, size = 64): Buffer {
  const bytes = Buffer.alloc(size);
  bytes.write(value, offset, 'ascii');
  return bytes;
}

test('detects supported raster image signatures', () => {
  assert.equal(detectPrivateMediaType(Buffer.from([0xff, 0xd8, 0xff, 0xe0])), 'image/jpeg');

  const png = Buffer.alloc(12);
  png.set([0x89, 0x50, 0x4e, 0x47], 0);
  assert.equal(detectPrivateMediaType(png), 'image/png');

  const webp = signature('RIFF');
  webp.write('WEBP', 8, 'ascii');
  assert.equal(detectPrivateMediaType(webp), 'image/webp');
  assert.equal(detectPrivateMediaType(signature('GIF89a')), 'image/gif');
});

test('detects ISO image brands before generic MP4 brands', () => {
  const avif = signature('ftyp', 4);
  avif.write('avif', 8, 'ascii');
  assert.equal(detectPrivateMediaType(avif), 'image/avif');

  const heic = signature('ftyp', 4);
  heic.write('heic', 8, 'ascii');
  assert.equal(detectPrivateMediaType(heic), 'image/heic');

  const heif = signature('ftyp', 4);
  heif.write('mif1', 8, 'ascii');
  assert.equal(detectPrivateMediaType(heif), 'image/heif');
});

test('keeps audio and video ISO containers distinct', () => {
  const audio = signature('ftyp', 4);
  audio.write('M4A ', 8, 'ascii');
  assert.equal(detectPrivateMediaType(audio), 'audio/mp4');

  const video = signature('ftyp', 4);
  video.write('isom', 8, 'ascii');
  assert.equal(detectPrivateMediaType(video), 'video/mp4');
});

test('detects PDF documents by file signature', () => {
  assert.equal(detectPrivateMediaType(signature('%PDF-1.7')), 'application/pdf');
});

test('detects office and archive container signatures', () => {
  assert.equal(detectPrivateMediaType(Buffer.from([0x50, 0x4b, 0x03, 0x04])), 'application/zip');
  assert.equal(
    detectPrivateMediaType(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])),
    'application/x-ole-storage',
  );
  assert.equal(detectPrivateMediaType(signature('Rar!\u001a\u0007\u0000')), 'application/vnd.rar');
  assert.equal(
    detectPrivateMediaType(Buffer.from([0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c])),
    'application/x-7z-compressed',
  );
});

test('detects plain-text document bytes', () => {
  assert.equal(detectPrivateMediaType(Buffer.from('name,email\nSam,sam@example.com\n')), 'text/plain');
});
