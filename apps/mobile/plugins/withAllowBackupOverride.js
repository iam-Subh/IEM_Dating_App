const { withAndroidManifest } = require('expo/config-plugins');

/**
 * The app turns Android backup off (allowBackup="false", so SecureStore's keys
 * never land in a backup), but TAndroidLame - the voice-note MP3 encoder -
 * declares allowBackup="true", and the manifest merger refuses the build.
 * tools:replace keeps ours. A plugin, so `expo prebuild` never drops it.
 */
module.exports = function withAllowBackupOverride(config) {
  return withAndroidManifest(config, (config) => {
    const manifest = config.modResults.manifest;
    manifest.$['xmlns:tools'] = manifest.$['xmlns:tools'] || 'http://schemas.android.com/tools';
    const application = manifest.application?.[0];
    if (application) {
      const existing = (application.$['tools:replace'] || '').split(',').map((item) => item.trim()).filter(Boolean);
      if (!existing.includes('android:allowBackup')) existing.push('android:allowBackup');
      application.$['tools:replace'] = existing.join(',');
    }
    return config;
  });
};
