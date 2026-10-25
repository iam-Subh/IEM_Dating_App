import { registerRootComponent } from 'expo';
import { AppRegistry } from 'react-native';
import { ChatBubbleRoot } from './src/features/chat/bubble/ChatBubbleRoot';

import App from './App';
import { definePushTask } from './src/features/notifications/push/backgroundTask';

// Notification buttons and silent pushes run here even when the app is
// killed, so the task is defined before anything else (NOTIFICATIONS_PLAN.md 8).
definePushTask();

// A chat in a bubble runs its own small root (MESSAGE_NOTIFICATIONS_PLAN.md 12).
AppRegistry.registerComponent('ChatBubble', () => ChatBubbleRoot);

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
// It also ensures that whether you load the app in Expo Go or in a native build,
// the environment is set up appropriately
registerRootComponent(App);
