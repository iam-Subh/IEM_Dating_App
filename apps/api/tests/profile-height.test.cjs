const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function load(file, dependencies = {}) {
  const exports = {};
  const source = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src', file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  vm.runInNewContext(source, { exports, console, Date, URL, require: name => {
    if (Object.hasOwn(dependencies, name)) return dependencies[name];
    if (name === 'zod') return require(name);
    throw new Error(`Unexpected dependency: ${name}`);
  } });
  return exports;
}

const { updateProfileSchema } = load('schemas/profile.schema.ts');
const { validateRequest } = load('middlewares/validate.middleware.ts', {
  '../utils/ApiResponse': { ApiResponse: { error: (message, details) => ({ success: false, message, details }) } },
});

test('height survives profile request validation throughout the mobile picker range', async () => {
  for (let height = 91; height <= 244; height++) {
    const request = { body: { height }, params: {}, query: {} };
    let forwarded = false;
    await validateRequest(updateProfileSchema)(request, {}, () => { forwarded = true; });
    assert.equal(forwarded, true);
    assert.equal(request.body.height, height);
  }
});

test('profile validation rejects invalid heights and preserves updates without a height', () => {
  for (const height of [90, 245, 165.5, '165', null, NaN, Infinity]) {
    assert.equal(updateProfileSchema.safeParse({ body: { height } }).success, false);
  }
  assert.equal(updateProfileSchema.safeParse({ body: { degree: 'B.Tech' } }).success, true);
});

test('a validated height reaches storage and is returned by both Save and profile reload', async () => {
  const record = { id: 'account', height: null, name: 'Student', photos: [], avatarUrl: null,
    profileVideoUrl: null, videoPreviewUrl: null, studentMembership: null };
  const selectRecord = select => Object.fromEntries(Object.entries(record).filter(([key]) => select[key]));
  const user = {
    findUniqueOrThrow: async ({ select }) => selectRecord(select),
    findUnique: async ({ select }) => selectRecord(select),
    update: async ({ data, select }) => { Object.assign(record, data); return selectRecord(select); },
  };
  const prisma = { user, $transaction: async fn => fn({ user, profileMediaAsset: { updateMany: async () => {} } }) };
  const { ProfileService } = load('services/profile.service.ts', {
    './profile-media-processing.service': {}, '../config/storage': {},
    '@iem-dating/shared/interest-catalog': {}, './eligibility.service': {}, '@iem-dating/shared/location': {},
    './location.service': {}, './campus.service': {}, '../utils/httpError': {},
    '../utils/prisma': { prisma },
    './mediaCache.service': { MediaCacheService: { invalidateCache: async () => {} } },
    '../socket': { getIO: () => null },
    '../middlewares/upload.middleware': { transformToCdnUrl: value => value },
    './outbox.service': {},
  });
  for (const height of [165, 197, 244, 91]) {
    const request = { body: { height }, params: {}, query: {} };
    await validateRequest(updateProfileSchema)(request, {}, () => {});
    const saved = await ProfileService.updateProfile(record.id, request.body);
    assert.equal(record.height, height);
    assert.equal(saved.height, height);
    assert.equal((await ProfileService.getProfile(record.id)).height, height);
  }
});
