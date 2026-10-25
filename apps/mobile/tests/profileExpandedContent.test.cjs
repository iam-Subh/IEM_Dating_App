const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const React = require('react');

function load(relative, dependencies = {}) {
  const exported = {};
  const source = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src', relative), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.React, esModuleInterop: true },
  }).outputText;
  vm.runInNewContext(source, { exports: exported, require: name => {
    if (Object.hasOwn(dependencies, name)) return dependencies[name];
    if (name.endsWith('.png')) {
      const asset = path.resolve(__dirname, '../src', path.dirname(relative), name);
      assert.ok(fs.existsSync(asset), `Missing club artwork: ${asset}`);
      return asset;
    }
    return require(name);
  } });
  return exported;
}
const campus = load('core/profile/campusIcons.ts');
const about = load('core/profile/aboutMeIcons.ts');
const gradients = load('core/profile/interestGradient.ts');
const { buildProfilePreview } = load('screens/main/profile/profilePreviewModel.ts', {
  '../../../core/profile/campusIcons': campus,
  '../../../core/profile/aboutMeIcons': about,
});
const { ProfileContentSections, ProfileInterestPills, profileInterestEmoji } = load('components/ProfileContentSections.tsx', {
  'react-native': { View: 'View', Text: 'Text', Image: 'Image', Platform: {OS: 'android'}, StyleSheet: { create: styles => styles, hairlineWidth: 1 } },
  '@expo/vector-icons': { Ionicons: 'Icon' },
  'expo-linear-gradient': { LinearGradient: 'Gradient' },
  './ProfileFieldIcon': { ProfileFieldIcon: 'Icon' },
  '../core/profile/campusIcons': campus,
  '../core/profile/aboutMeIcons': about,
  '../core/profile/interestGradient': gradients,
  '../features/auth/onboarding/InterestVisuals': load('features/auth/onboarding/InterestVisuals.ts'),
  '../core/profile/clubArtwork': load('core/profile/clubArtwork.ts'),
});
const { demoProfiles } = load('features/discovery/demo/demoProfiles.ts', {
  '../../../store': { store: { getState: () => ({ auth: { user: null } }) } },
  '../../location/distanceUnits': { distanceBand: () => '', unitOf: () => 'km' },
});
function textOf(node) {
  if (node == null || typeof node === 'boolean') return [];
  if (typeof node === 'string' || typeof node === 'number') return [String(node)];
  if (Array.isArray(node)) return node.flatMap(textOf);
  if (typeof node.type === 'function') return textOf(node.type(node.props));
  return textOf(node.props?.children);
}
function expanded(profile, extra = {}) {
  return ProfileContentSections({ data: buildProfilePreview({ ...profile, photos: [] }), ...extra });
}

test('interest icons match for saved IDs, shared-interest labels, and profile sections', () => {
  assert.equal(profileInterestEmoji('photography'), '📷');
  assert.equal(profileInterestEmoji('Photography'), '📷');
  const shared = textOf(ProfileInterestPills({values: ['Photography'], showIcons: true}));
  assert.ok(shared.includes('📷'));
  assert.ok(shared.includes('Photography'));
  const profile = textOf(expanded({preferences: {interests: ['photography']}}));
  assert.ok(profile.includes('📷'));
  assert.ok(profile.includes('Photography'));
});

test('club pills use existing club artwork and preserve custom club labels', () => {
  const content = ProfileInterestPills({values: ['Robotics', 'Custom club'], group: 'Clubs', showClubArtwork: true});
  const nodes = React.Children.toArray(content.props.children);
  const first = React.Children.toArray(nodes[0].props.children);
  const image = first.find(node => node.type === 'Image');
  assert.ok(image);
  assert.ok(image.props.source.endsWith('robotics.png'));
  assert.ok(textOf(content).includes('Custom club'));
});

test('expanded content shows every saved public detail, including Clubs and Favourite places', () => {
  const profile = demoProfiles.find(profile => profile.id === 'aanya');
  const content = expanded(profile);
  const cards = React.Children.toArray(content.props.children).filter(node => node.type?.name === 'ProfileContentCard');
  const clubs = cards.find(card => card.props.title === 'Clubs');
  const places = cards.find(card => card.props.title === 'Favourite places');
  assert.ok(clubs, 'Clubs must have its own card');
  assert.ok(places, 'Favourite places must have its own card');
  assert.notEqual(clubs, places);
  const text = textOf(content);
  for (const value of ['Bio', 'About me', 'Campus life', 'Department', 'Degree', 'Class', 'Year of study',
    'Residency', 'Attendance mood', 'Height', 'Gender', 'Orientation', 'Interests', 'Clubs', 'Favourite places',
    'Personality', 'Lifestyle', 'Photography', 'Music/Band', 'RDB', 'Campus cafe',
    profile.college, profile.department, profile.degree, profile.preferences.bio]) {
    assert.ok(text.includes(value), `Missing expanded detail: ${value}`);
  }
});

test('expanded content respects hidden gender and orientation while retaining community details', () => {
  const text = textOf(expanded({ height: 172, gender: 'Man', showGender: false,
    orientation: ['Straight'], showOrientation: false, clubs: ['Robotics'], hangoutSpots: ['Library'] }));
  assert.ok(!text.includes('Gender'));
  assert.ok(!text.includes('Man'));
  assert.ok(!text.includes('Orientation'));
  assert.ok(!text.includes('Straight'));
  assert.ok(text.includes('172 cm'));
  assert.ok(text.includes('Robotics'));
  assert.ok(text.includes('Library'));
});

test('gallery positions remain present when profile details are empty', () => {
  const slots = [];
  const text = textOf(expanded({}, { afterSection: section => { slots.push(section); return null; } }));
  assert.deepEqual(slots, ['bio', 'campus', 'interests', 'lifestyle']);
  assert.deepEqual(text, []);
});

test('every demo profile shows Clubs and Favourite places', () => {
  for (const profile of demoProfiles) {
    const text = textOf(expanded(profile));
    assert.ok(text.includes('Clubs'), `${profile.id}: missing Clubs`);
    assert.ok(text.includes('Favourite places'), `${profile.id}: missing Favourite places`);
    for (const value of [...profile.clubs, ...profile.hangoutSpots]) {
      assert.ok(text.includes(value), `${profile.id}: missing ${value}`);
    }
  }
});
