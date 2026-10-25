const { withAndroidManifest } = require('expo/config-plugins');

/**
 * Sharing into IEM Connect from other apps (MESSAGE_NOTIFICATIONS_PLAN.md 12):
 * text and pictures, either to the app (it then asks which chat) or straight
 * to a chat - "Share to Riya" - through the chats' shortcuts and
 * res/xml/chat_share_targets.xml (in modules/chat-notify).
 */
module.exports = function withShareTargets(config) {
  return withAndroidManifest(config, (config) => {
    const application = config.modResults.manifest.application?.[0];
    const main = application?.activity?.find((activity) => activity.$['android:name'] === '.MainActivity');
    if (!main) return config;
    main['intent-filter'] = main['intent-filter'] || [];
    const has = (mime) => main['intent-filter'].some((filter) =>
      filter.action?.some((action) => action.$['android:name'] === 'android.intent.action.SEND')
      && filter.data?.some((data) => data.$['android:mimeType'] === mime));
    for (const mime of ['text/plain', 'image/*']) {
      if (has(mime)) continue;
      main['intent-filter'].push({
        action: [{ $: { 'android:name': 'android.intent.action.SEND' } }],
        category: [{ $: { 'android:name': 'android.intent.category.DEFAULT' } }],
        data: [{ $: { 'android:mimeType': mime } }],
      });
    }
    main['meta-data'] = (main['meta-data'] || []).filter((item) => item.$['android:name'] !== 'android.app.shortcuts');
    main['meta-data'].push({ $: { 'android:name': 'android.app.shortcuts', 'android:resource': '@xml/chat_share_targets' } });
    return config;
  });
};
