import React from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import { ago, type NotificationItem } from './notificationModel';
import { systemNoticeOf, type SystemNoticeAction } from './systemNoticeModel';

export function SystemNotice({ item, now, fresh, menuOpen, menu, onPress, onLongPress, onAction }: {
  item: NotificationItem;
  now: number;
  fresh: boolean;
  menuOpen?: boolean;
  menu?: React.ReactNode;
  onPress: () => void;
  onLongPress?: () => void;
  onAction: (action: SystemNoticeAction) => void;
}) {
  const notice = systemNoticeOf(item);
  const welcome = notice.layout === 'welcome';
  const openNotice = () => {
    if (menuOpen) onPress();
    else if (notice.action) onAction(notice.action.destination);
    else onPress();
  };
  return (
    <Animated.View entering={fresh ? FadeInDown.duration(220) : undefined}
      style={[styles.card, menuOpen && styles.menuOpen]}>
      <Pressable onPress={openNotice} onLongPress={onLongPress} delayLongPress={350}
        accessibilityRole="button"
        accessibilityLabel={`IEM Connect. ${notice.title}. ${notice.body}${item.isRead ? '' : '. Unread'}`}
        accessibilityHint={notice.action?.label}
        style={({ pressed }) => [styles.row, pressed && styles.pressed]}>
        <View accessible={false} style={[styles.icon, welcome && styles.welcomeIcon]}>
          {welcome ? <Image source={require('../../../assets/adaptive-icon.png')} style={styles.logo} resizeMode="contain" fadeDuration={0} />
            : <Ionicons name={notice.icon} size={20} color="#D8D5D1" />}
        </View>
        <View style={styles.copy}>
          <Text style={styles.message}>
            <Text style={styles.title}>{notice.title}</Text>
            {!!notice.body && `\n${notice.body}`}
          </Text>
          <Text style={styles.time}>{ago(item.createdAt, now)}</Text>
        </View>
        {!item.isRead && <View style={styles.dot} />}
      </Pressable>
      {menu}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: 12, overflow: 'hidden', marginBottom: 6 },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, paddingHorizontal: 10, paddingVertical: 12, borderRadius: 12 },
  menuOpen: { backgroundColor: '#242321' },
  pressed: { backgroundColor: '#211F1D' },
  icon: { width: 40, height: 40, borderRadius: 20, backgroundColor: '#242321', alignItems: 'center', justifyContent: 'center' },
  welcomeIcon: { backgroundColor: '#38262D' },
  logo: { width: 32, height: 32 },
  copy: { flex: 1, minWidth: 0 },
  title: { color: '#F1EFEC', fontWeight: '600' },
  message: { color: '#B7B3AE', fontSize: 13, lineHeight: 18 },
  time: { color: '#817D78', fontSize: 11, lineHeight: 15, marginTop: 4 },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#E8B8C5', marginTop: 7 },
});
