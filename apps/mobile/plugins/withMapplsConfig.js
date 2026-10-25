const fs = require("fs");
const path = require("path");
const { withDangerousMod } = require("expo/config-plugins");

/**
 * Copies the Mappls credential files into android/app on every prebuild.
 *
 * Mappls authorises the map with two files from its console, `<appId>.a.olf`
 * and `<appId>.a.conf`; the SDK's Gradle step looks for them beside
 * android/app/build.gradle. android/ is generated and ignored by git, so the
 * files live in `mappls/` (also ignored) and are put back each time.
 *
 * Missing files are not an error: the build still succeeds, and the app falls
 * back to the image-tile map (see features/location/MapplsMap.tsx).
 */
module.exports = function withMapplsConfig(config) {
  return withDangerousMod(config, [
    "android",
    async (next) => {
      const source = path.join(next.modRequest.projectRoot, "mappls");
      const target = path.join(next.modRequest.platformProjectRoot, "app");
      const files = fs.existsSync(source)
        ? fs.readdirSync(source).filter((name) => name.endsWith(".a.olf") || name.endsWith(".a.conf"))
        : [];
      if (files.length === 0) {
        console.warn("[withMapplsConfig] No .a.olf/.a.conf in mappls/; the Mappls map will not be authorised.");
      }
      for (const name of files) {
        fs.copyFileSync(path.join(source, name), path.join(target, name));
      }
      return next;
    },
  ]);
};
