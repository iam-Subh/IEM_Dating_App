import React from 'react';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { DiscoverScreen } from '../features/discovery/screens/DiscoverScreen';
import { ChatListScreen } from '../screens/main/ChatListScreen';
import { ProfileScreen } from '../screens/main/ProfileScreen';
import { CustomTabBar } from './CustomTabBar';
import { ExploreScreen } from '../screens/main/ExploreScreen';
import { MatchesScreen } from '../screens/main/MatchesScreen';

const Tab = createBottomTabNavigator();

export const MainTabNavigator = () => {
  return (
    <Tab.Navigator 
      tabBar={(props) => <CustomTabBar {...props} />}
      screenOptions={{ 
        headerShown: false,
        tabBarStyle: { backgroundColor: 'transparent', elevation: 0, borderTopWidth: 0 },
      }}
    >
      <Tab.Screen name="Dashboard" component={DiscoverScreen} />
      <Tab.Screen name="Search" component={ExploreScreen} />
      <Tab.Screen name="Matches" component={MatchesScreen} />
      <Tab.Screen name="Chats" component={ChatListScreen} />
      <Tab.Screen name="Profile" component={ProfileScreen} />
    </Tab.Navigator>
  );
};
