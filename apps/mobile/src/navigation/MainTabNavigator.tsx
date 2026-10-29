import React from 'react';
import {BackHandler, StatusBar, StyleSheet, View} from 'react-native';
import {useSelector} from 'react-redux';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import type {RootState} from '../store';
import { GlassSource, hasGlassSurface } from '../../modules/glass-surface';
import { createBottomTabNavigator, BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { DiscoverScreen } from '../features/discovery/screens/DiscoverScreen';
import { ChatListScreen } from '../screens/main/ChatListScreen';
import { ProfileScreen } from '../screens/main/ProfileScreen';
import { GlassTabBar } from './GlassTabBar';
import { SearchScreen } from '../features/search/SearchScreen';
import { MatchesScreen } from '../screens/main/MatchesScreen';
import {DiscoveryArrival} from '../features/discovery/components/DiscoveryArrival';
import {getDiscoveryArrival, subscribeDiscoveryArrival} from '../features/discovery/discoveryArrival';
import {peekNewcomer, setNewcomerTeachingActive, takeNewcomer} from '../features/teaching/tipsSeen';
import {WelcomeTour} from '../features/teaching/WelcomeTour';
import {SwipeLesson} from '../features/teaching/SwipeLesson';

const Tab = createBottomTabNavigator();
type WelcomeStep = 'checking' | 'tour' | 'lesson' | null;
function initialWelcome(userId?: string): WelcomeStep {
  if (!userId) return null;
  const pending = peekNewcomer(userId);
  return pending === undefined ? 'checking' : pending ? 'tour' : null;
}

function BarPortal({ bar, publish }: { bar: BottomTabBarProps; publish: (bar: BottomTabBarProps) => void }) {
  React.useLayoutEffect(() => { publish(bar); }, [publish, bar.state, bar.navigation,
    bar.insets.top, bar.insets.bottom, bar.insets.left, bar.insets.right]);
  return null;
}

export const MainTabNavigator = () => {
  const arrival = React.useSyncExternalStore(subscribeDiscoveryArrival, getDiscoveryArrival);
  const userId = useSelector((state: RootState) => state.auth.user?.id);
  const insets = useSafeAreaInsets();
  const [welcome, setWelcome] = React.useState<WelcomeStep>(() => initialWelcome(userId));
  React.useLayoutEffect(() => {setNewcomerTeachingActive(welcome !== null);}, [welcome]);
  React.useLayoutEffect(() => () => setNewcomerTeachingActive(false), []);
  React.useLayoutEffect(() => {
    setWelcome(initialWelcome(userId));
    if (!userId) return;
    let live = true;
    void takeNewcomer(userId).then(pending => {
      if (live) setWelcome(current => current === 'checking' ? pending ? 'tour' : null : current);
    });
    return () => {live = false;};
  }, [userId]);
  const advanceWelcome = () => setWelcome(step => step === 'tour' ? 'lesson' : null);
  React.useEffect(() => {
    if (!welcome || arrival.active) return;
    const listener = BackHandler.addEventListener('hardwareBackPress', () => {advanceWelcome(); return true;});
    return () => listener.remove();
  }, [welcome, arrival.active]);
  const covered = arrival.active || welcome !== null;
  const [bar, setBar] = React.useState<BottomTabBarProps | null>(null);
  return (
    <View collapsable={false} style={{ flex: 1 }}>
    <View style={{flex: 1}} accessibilityElementsHidden={covered} importantForAccessibility={covered ? 'no-hide-descendants' : 'auto'}>
    <GlassSource collapsable={false} style={{ flex: 1 }}>
    <Tab.Navigator 
      tabBar={(props) => welcome ? null : hasGlassSurface ? <BarPortal bar={props} publish={setBar} /> : <GlassTabBar {...props} />}
      screenOptions={{ 
        headerShown: false,
        tabBarStyle: { backgroundColor: 'transparent', elevation: 0, borderTopWidth: 0 },
      }}
    >
      <Tab.Screen name="Dashboard">{() => <DiscoverScreen teachingActive={welcome !== null}/>}</Tab.Screen>
      <Tab.Screen name="Search" component={SearchScreen} />
      <Tab.Screen name="Matches" component={MatchesScreen} />
      <Tab.Screen name="Chats" component={ChatListScreen} />
      <Tab.Screen name="Profile" component={ProfileScreen} />
    </Tab.Navigator>
    </GlassSource>
    {hasGlassSurface && bar && !welcome && <GlassTabBar {...bar} />}
    </View>
    {welcome !== null && <View accessibilityViewIsModal
      accessibilityElementsHidden={arrival.active} importantForAccessibility={arrival.active ? 'no-hide-descendants' : 'auto'}
      style={[StyleSheet.absoluteFill, {backgroundColor: '#100F0D', zIndex: 90, elevation: 29}]}>
      {!arrival.active && <StatusBar barStyle="light-content"/>}
      {welcome === 'tour' ? <WelcomeTour onDone={advanceWelcome} doneLabel="Try swiping" topInset={insets.top} bottomInset={insets.bottom}/>
        : welcome === 'lesson' ? <SwipeLesson onDone={advanceWelcome} topInset={insets.top} bottomInset={insets.bottom}/>
        : null}
    </View>}
    <DiscoveryArrival revealToDeck={welcome === null}/>
    </View>
  );
};
