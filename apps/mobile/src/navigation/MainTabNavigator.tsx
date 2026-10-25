import React from 'react';
import { View } from 'react-native';
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

const Tab = createBottomTabNavigator();

function BarPortal({ bar, publish }: { bar: BottomTabBarProps; publish: (bar: BottomTabBarProps) => void }) {
  React.useLayoutEffect(() => { publish(bar); }, [publish, bar.state, bar.navigation,
    bar.insets.top, bar.insets.bottom, bar.insets.left, bar.insets.right]);
  return null;
}

export const MainTabNavigator = () => {
  const arrival = React.useSyncExternalStore(subscribeDiscoveryArrival, getDiscoveryArrival);
  const [bar, setBar] = React.useState<BottomTabBarProps | null>(null);
  return (
    <View collapsable={false} style={{ flex: 1 }}>
    <View style={{flex: 1}} accessibilityElementsHidden={arrival.active} importantForAccessibility={arrival.active ? 'no-hide-descendants' : 'auto'}>
    <GlassSource collapsable={false} style={{ flex: 1 }}>
    <Tab.Navigator 
      tabBar={(props) => hasGlassSurface ? <BarPortal bar={props} publish={setBar} /> : <GlassTabBar {...props} />}
      screenOptions={{ 
        headerShown: false,
        tabBarStyle: { backgroundColor: 'transparent', elevation: 0, borderTopWidth: 0 },
      }}
    >
      <Tab.Screen name="Dashboard" component={DiscoverScreen} />
      <Tab.Screen name="Search" component={SearchScreen} />
      <Tab.Screen name="Matches" component={MatchesScreen} />
      <Tab.Screen name="Chats" component={ChatListScreen} />
      <Tab.Screen name="Profile" component={ProfileScreen} />
    </Tab.Navigator>
    </GlassSource>
    {hasGlassSurface && bar && <GlassTabBar {...bar} />}
    </View>
    <DiscoveryArrival />
    </View>
  );
};
