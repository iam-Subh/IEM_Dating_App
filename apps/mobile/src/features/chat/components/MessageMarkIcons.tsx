import React from 'react';
import { View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

export function MessageMarkIcons({ starred, pinned, color = '#C6B7BF' }: { starred?: boolean; pinned?: boolean; color?: string }) {
  if (!starred && !pinned) return null;
  return <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3, marginRight: 4 }}>
    {starred ? <Ionicons name="star" size={11} color={color} accessibilityLabel="Starred message. Only you can see this star." /> : null}
    {pinned ? <Ionicons name="pin" size={11} color={color} accessibilityLabel="Pinned message" /> : null}
  </View>;
}
