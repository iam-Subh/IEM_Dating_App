const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const campusModule = {};
vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname,
  '../src/core/profile/campusIcons.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText, { exports: campusModule });
const aboutModule = {};
vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname,
  '../src/core/profile/aboutMeIcons.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText, { exports: aboutModule });
const exported = {};
vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname,
  '../src/screens/main/profile/profilePreviewModel.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText, { exports: exported, require: name => name === '../../../core/profile/campusIcons' ? campusModule : name === '../../../core/profile/aboutMeIcons' ? aboutModule : require(name) });
const { buildProfilePreview } = exported;

test('the main photo appears first without duplicates or invalid photo slots', () => {
  const photos = [{ photoUrl: 'one' }, { photoUrl: ' main ', isPrimary: true }, { photoUrl: 'one' }, { photoUrl: '' }];
  const preview = buildProfilePreview({ photos, profileVideoUrl: 'video.mp4', avatarUrl: 'avatar' });
  assert.deepEqual(Array.from(preview.photos), ['main', 'one']);
  assert.equal(preview.video, 'video.mp4');
  assert.deepEqual(Array.from(preview.media, item => item.type), ['video', 'image', 'image']);
  assert.equal(preview.media[0].uri, 'video.mp4');
  assert.equal(preview.media[1].photoIndex, 0);
  assert.equal(photos[0].photoUrl, 'one');
});

test('the saved avatar is the fallback when no photo can be displayed', () => {
  assert.deepEqual(Array.from(buildProfilePreview({ avatarUrl: ' avatar ', photos: [{ photoUrl: '' }] }).photos), ['avatar']);
  assert.equal(buildProfilePreview({}).photos.length, 0);
});

test('hidden gender and orientation do not appear in the preview', () => {
  const preview = buildProfilePreview({ height: 175, gender: 'Man', showGender: false, orientation: ['Straight'], showOrientation: false });
  assert.deepEqual(Array.from(preview.basics, fact => fact.label), ['Height']);
  const visible = buildProfilePreview({ gender: 'Man', showGender: true, orientation: ['Straight'], showOrientation: true });
  assert.equal(visible.basics.find(fact => fact.label === 'Gender').value, 'Man');
  assert.equal(visible.basics.find(fact => fact.label === 'Orientation').value, 'Straight');
});

test('empty answers do not create empty profile sections or false verification', () => {
  const preview = buildProfilePreview({ preferences: { bio: ' ', personality: { communication: '', extra: 'private' }, lifestyle: { drink: null } } });
  assert.equal(preview.bio, '');
  assert.equal(preview.personality.length, 0);
  assert.equal(preview.lifestyle.length, 0);
  assert.equal(preview.verified, false);
  assert.equal('matchPercentage' in preview, false);
});

test('profile details include saved interests, campus, personality, and lifestyle', () => {
  const preview = buildProfilePreview({ college: 'College', department: 'CSE', degree: 'B.Tech', isHosteller: false,
    clubs: ['Robotics', 'Robotics'], hangoutSpots: ['Cafe'],
    preferences: { bio: 'My bio', interests: ['poetry'], personality: { communication: 'better_in_person' }, lifestyle: { exercise: 'every_day' } } });
  assert.equal(preview.bio, 'My bio');
  assert.equal(preview.course, 'CSE · B.Tech');
  assert.equal(preview.campus.find(fact => fact.label === 'Residency').value, 'Day scholar');
  assert.equal(preview.interestGroups.find(group => group.title === 'Clubs').values.length, 1);
  assert.equal(preview.interestGroups.find(group => group.title === 'Things I like').values.length, 1);
  assert.equal(preview.personality[0].value, 'Better in person');
  assert.equal(preview.lifestyle[0].value, 'Every day');
});

test('the gallery contains at most six photos', () => {
  const preview = buildProfilePreview({ profileVideoUrl: 'video.mp4', photos: Array.from({ length: 9 }, (_, index) => ({ photoUrl: `photo-${index}`, isPrimary: index === 8 })) });
  assert.equal(preview.photos.length, 6);
  assert.equal(preview.media.length, 7);
  assert.equal(preview.photos[0], 'photo-8');
});

test('photo positions remain correct when the video occupies the first gallery position', () => {
  const preview = buildProfilePreview({ profileVideoUrl: 'video.mp4', photos: Array.from({ length: 6 }, (_, index) => ({ photoUrl: `photo-${index}` })) });
  preview.photos.forEach((uri, photoIndex) => {
    const mediaIndex = preview.media.findIndex(item => item.type === 'image' && item.photoIndex === photoIndex);
    assert.equal(mediaIndex, photoIndex + 1);
    assert.equal(preview.media[mediaIndex].uri, uri);
  });
  const noVideo = buildProfilePreview({ photos: [{ photoUrl: 'photo' }] });
  assert.equal(noVideo.media[0].type, 'image');
  assert.equal(noVideo.media[0].photoIndex, 0);
});


test('shared campus content retains degree and year of study without a college', () => {
  const preview = buildProfilePreview({ department: 'CSE', degree: 'M.Tech', yearOfStudy: 2, graduationYear: 2027 });
  assert.equal(preview.degree, 'M.Tech');
  assert.equal(preview.department, 'CSE');
  assert.equal(preview.college, '');
  assert.equal(preview.campus.find(fact => fact.label === 'Year of study').value, 'Year 2');
  assert.equal(preview.campus.find(fact => fact.label === 'Year of study').icon, campusModule.CAMPUS_ICONS.yearOfStudy);
  assert.equal(preview.campus.find(fact => fact.label === 'Class').value, '2027');
});
