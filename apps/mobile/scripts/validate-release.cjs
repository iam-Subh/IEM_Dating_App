const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const app = JSON.parse(fs.readFileSync(path.join(root, 'app.json'), 'utf8')).expo;
const eas = JSON.parse(fs.readFileSync(path.join(root, 'eas.json'), 'utf8'));
const errors = [];

function requireValue(value, message) {
  if (!value) errors.push(message);
}

function pluginNames() {
  return new Set((app.plugins ?? []).map((entry) => Array.isArray(entry) ? entry[0] : entry));
}

requireValue(app.name === 'IEM Connect', 'expo.name must be IEM Connect.');
requireValue(app.slug === 'iem-connect', 'expo.slug must be iem-connect.');
requireValue(app.scheme === 'iemdating', 'expo.scheme must be iemdating.');
requireValue(/^\d+\.\d+\.\d+$/.test(app.version ?? ''), 'expo.version must use major.minor.patch format.');

const androidPackage = app.android?.package;
const iosBundle = app.ios?.bundleIdentifier;
const reverseDns = /^[a-z][a-z0-9]*(\.[a-z][a-z0-9]*){2,}$/;
requireValue(reverseDns.test(androidPackage ?? ''), 'android.package must be a reverse-DNS identifier.');
requireValue(reverseDns.test(iosBundle ?? ''), 'ios.bundleIdentifier must be a reverse-DNS identifier.');
requireValue(androidPackage === iosBundle, 'Android and iOS must use the same application identifier.');
requireValue(!/anonymous|example|placeholder|mobile$/i.test(androidPackage ?? ''), 'The application identifier contains a placeholder value.');
requireValue(Number.isInteger(app.android?.versionCode) && app.android.versionCode > 0, 'android.versionCode must be a positive integer.');
requireValue(/^\d+$/.test(app.ios?.buildNumber ?? ''), 'ios.buildNumber must be a positive integer string.');

const usageKeys = [
  'NSCameraUsageDescription',
  'NSPhotoLibraryUsageDescription',
  'NSMicrophoneUsageDescription',
  'NSLocationWhenInUseUsageDescription',
];
for (const key of usageKeys) requireValue((app.ios?.infoPlist?.[key] ?? '').length >= 20, `ios.infoPlist.${key} is missing or too short.`);

const requiredPlugins = ['expo-location', 'expo-secure-store', 'expo-notifications', 'expo-image-picker', 'expo-camera'];
const plugins = pluginNames();
for (const plugin of requiredPlugins) requireValue(plugins.has(plugin), `Required Expo plugin is missing: ${plugin}.`);

for (const asset of [app.icon, app.android?.adaptiveIcon?.foregroundImage, app.web?.favicon]) {
  requireValue(typeof asset === 'string' && fs.existsSync(path.resolve(root, asset ?? '')), `Configured asset does not exist: ${asset ?? '(missing)'}.`);
}

for (const profile of ['development', 'preview', 'production']) requireValue(eas.build?.[profile], `EAS build profile is missing: ${profile}.`);
requireValue(eas.submit?.production, 'The EAS production submit profile is missing.');

if (process.argv.includes('--environment')) {
  const apiUrl = process.env.EXPO_PUBLIC_API_URL;
  const socketUrl = process.env.EXPO_PUBLIC_SOCKET_URL;
  const projectId = process.env.EAS_PROJECT_ID ?? app.extra?.eas?.projectId;
  requireValue(apiUrl, 'EXPO_PUBLIC_API_URL is required for release environment validation.');
  requireValue(socketUrl, 'EXPO_PUBLIC_SOCKET_URL is required for release environment validation.');
  requireValue(projectId, 'An EAS project ID is required. Run eas init or set EAS_PROJECT_ID.');
  for (const [name, value] of [['EXPO_PUBLIC_API_URL', apiUrl], ['EXPO_PUBLIC_SOCKET_URL', socketUrl]]) {
    if (!value) continue;
    try {
      const parsed = new URL(value);
      requireValue(parsed.protocol === 'https:', `${name} must use HTTPS.`);
      requireValue(!['localhost', '127.0.0.1', '10.0.2.2'].includes(parsed.hostname), `${name} must not use a local host.`);
      requireValue(!parsed.hostname.endsWith('.loca.lt'), `${name} must not use the development tunnel.`);
      if (name === 'EXPO_PUBLIC_API_URL') requireValue(parsed.pathname.replace(/\/$/, '').endsWith('/api/v1'), 'EXPO_PUBLIC_API_URL must end with /api/v1.');
    } catch {
      errors.push(`${name} must be a valid URL.`);
    }
  }
}

if (errors.length) {
  console.error('Mobile release validation failed:');
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log(`Mobile release configuration is valid for ${app.name} ${app.version}.`);
if (!process.argv.includes('--environment')) console.log('Run release:validate:environment with the production API URL before a signed build.');
