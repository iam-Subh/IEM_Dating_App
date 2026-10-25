import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Linking, Pressable, Text, View } from 'react-native';
import { Provider } from 'react-redux';
import { PersistGate } from 'redux-persist/integration/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { DarkTheme, NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { KeyboardProvider } from 'react-native-keyboard-controller';
import { useFonts } from 'expo-font';
import { DMSans_400Regular, DMSans_500Medium, DMSans_700Bold } from '@expo-google-fonts/dm-sans';
import { Ionicons, MaterialIcons } from '@expo/vector-icons';
import { persistor, store } from '../../../store';
import { renewSession } from '../../../services/api';
import { initSocket } from '../../../services/socket';
import { ChatScreen } from '../screens/ChatScreen';
import { ChatAttachmentsScreen } from '../components/AttachmentPickerSheet';

/**
 * A chat in a bubble - the floating chat head (MESSAGE_NOTIFICATIONS_PLAN.md 12).
 * Android runs this root ("ChatBubble", registered in index.ts) inside the
 * bubble's small window: just the one chat. Anything that would leave the
 * chat - the profile, search, a story - opens the full app instead.
 */
const Stack = createNativeStackNavigator();
const queryClient = new QueryClient();

const openInApp = (matchId?: string) => { void Linking.openURL(matchId ? `iemdating://chat/${matchId}` : 'iemdating://main/Chats'); };

/** Never a silent black bubble: what went wrong, and a way into the full app. */
class BubbleBoundary extends React.Component<{ matchId?: string; children: React.ReactNode }, { error: string | null }> {
  state = { error: null as string | null };
  static getDerivedStateFromError(error: unknown) { return { error: String((error as Error)?.message ?? error) }; }
  componentDidCatch(error: unknown) { console.error('[ChatBubble]', error); }
  render() {
    if (!this.state.error) return this.props.children;
    return <View style={{ flex: 1, backgroundColor: '#100F0D', alignItems: 'center', justifyContent: 'center', padding: 24, gap: 12 }}>
      <Text style={{ color: '#fff', fontSize: 16, fontWeight: '700', textAlign: 'center' }}>Couldn't open this chat here</Text>
      <Text style={{ color: 'rgba(255,255,255,0.55)', fontSize: 12, textAlign: 'center' }}>{this.state.error}</Text>
      <Pressable onPress={() => openInApp(this.props.matchId)} style={{ backgroundColor: '#FF5A5F', borderRadius: 20, paddingHorizontal: 18, paddingVertical: 10 }}>
        <Text style={{ color: '#fff', fontWeight: '700' }}>Open in app</Text>
      </Pressable>
    </View>;
  }
}

export function ChatBubbleRoot({ matchId, title }: { matchId?: string; title?: string }) {
  const [fontsLoaded] = useFonts({ ...Ionicons.font, ...MaterialIcons.font, DMSans_400Regular, DMSans_500Medium, DMSans_700Bold });
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let active = true;
    // Started cold by the bubble: renew the session and connect, as the app does.
    (async () => {
      if (!store.getState().auth.token) await renewSession().catch(() => undefined);
      if (store.getState().auth.token) initSocket();
      if (active) setReady(true);
    })();
    return () => { active = false; };
  }, []);

  if (!matchId) return <BubbleBoundary><ThrowMissing /></BubbleBoundary>;
  if (!fontsLoaded || !ready) {
    return <View style={{ flex: 1, backgroundColor: '#100F0D', alignItems: 'center', justifyContent: 'center' }}>
      <ActivityIndicator color="#FF5A5F" />
    </View>;
  }

  return (
    <BubbleBoundary matchId={matchId}>
    <GestureHandlerRootView style={{ flex: 1 }}>
      <KeyboardProvider>
        <Provider store={store}>
          <PersistGate loading={null} persistor={persistor}>
            <QueryClientProvider client={queryClient}>
              <NavigationContainer
                theme={{ ...DarkTheme, colors: { ...DarkTheme.colors, background: '#100F0D' } }}
                // Leaving the chat from the bubble opens the full app on it.
                onUnhandledAction={() => { void Linking.openURL(`iemdating://chat/${matchId}`); }}
              >
                <Stack.Navigator screenOptions={{ headerShown: false, contentStyle: { backgroundColor: '#100F0D' } }}>
                  <Stack.Screen name="ChatScreen" component={ChatScreen} initialParams={{ matchId, userName: title }} />
                  <Stack.Screen name="ChatAttachments" component={ChatAttachmentsScreen} options={{
                    presentation: 'formSheet', sheetAllowedDetents: [0.75, 0.95], sheetInitialDetentIndex: 0,
                    sheetGrabberVisible: true, sheetCornerRadius: 28, sheetShouldOverflowTopInset: false,
                    contentStyle: { backgroundColor: '#242321' },
                  }} />
                </Stack.Navigator>
              </NavigationContainer>
            </QueryClientProvider>
          </PersistGate>
        </Provider>
      </KeyboardProvider>
    </GestureHandlerRootView>
    </BubbleBoundary>
  );
}

function ThrowMissing(): null {
  throw new Error('This bubble has no chat.');
}
