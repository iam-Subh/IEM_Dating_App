import React, { useState } from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../../services/api';
import type { ConversationPreview } from '../conversationPreview';

const RECEIPT_READ_COLOUR = '#38BDF8';
const RECEIPT_DELIVERED_COLOUR = '#96908D';

export function ConversationPreviewLine({ preview, unread = false, accountId = '' }: {
  preview: ConversationPreview; unread?: boolean; accountId?: string;
}) {
  const colour = preview.tone === 'error' ? '#F18B8F' : preview.tone === 'draft' ? '#E7AF8D' : preview.tone === 'activity' ? '#F3C1CA' : unread ? '#E8E3E0' : '#A6A19F';
  return <View style={styles.row} accessible accessibilityLabel={`${preview.status ? `${preview.status}. ` : ''}${preview.prefix}${preview.text}${preview.played ? '. Played' : ''}`}>
    {preview.status && <Ionicons name={preview.status === 'pending' ? 'time-outline' : preview.status === 'failed' ? 'alert-circle' : preview.status === 'sent' ? 'checkmark' : 'checkmark-done'}
      size={15} color={preview.status === 'read' ? RECEIPT_READ_COLOUR : preview.status === 'failed' ? '#F18B8F' : RECEIPT_DELIVERED_COLOUR} style={styles.icon} />}
    {preview.thumbnailKey ? <PreviewThumbnail key={`${accountId}:${preview.thumbnailKey}`} mediaKey={preview.thumbnailKey} accountId={accountId} icon={preview.icon} colour={colour} />
      : preview.icon ? <Ionicons name={preview.icon} size={14} color={preview.played ? RECEIPT_READ_COLOUR : colour} style={styles.icon} /> : null}
    <Text style={[styles.text, { color: colour }, unread && styles.unread, preview.tone === 'service' && styles.service]} numberOfLines={1} ellipsizeMode="tail">
      {preview.prefix ? <Text style={preview.tone === 'draft' ? { color: '#E7AF8D', fontWeight: '600' } : undefined}>{preview.prefix}</Text> : null}{preview.text}
    </Text>
  </View>;
}

function PreviewThumbnail({ mediaKey, accountId, icon, colour }: { mediaKey: string; accountId: string; icon?: ConversationPreview['icon']; colour: string }) {
  const [failed, setFailed] = useState(false);
  const { data } = useQuery({
    queryKey: ['conversation-thumbnail', accountId, mediaKey],
    queryFn: async () => {
      const response = await api.get('/chat/media/read', { params: { key: mediaKey } });
      if (typeof response.data?.data !== 'string') throw new Error('Thumbnail unavailable');
      return response.data.data as string;
    },
    enabled: Boolean(accountId), staleTime: 10 * 60_000, gcTime: 14 * 60_000, retry: false,
  });
  return data && !failed
    ? <Image source={{ uri: data }} style={styles.thumbnail} onError={() => setFailed(true)} accessible={false} fadeDuration={0} />
    : <Ionicons name={icon ?? 'image-outline'} size={14} color={colour} style={styles.icon} />;
}

const styles = StyleSheet.create({
  row: { flexGrow: 1, flexShrink: 1, flexBasis: 'auto', minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 4, height: 23 },
  text: { flex: 1, minWidth: 0, fontSize: 13, lineHeight: 19, fontFamily: 'DMSans_400Regular' },
  unread: { fontFamily: 'DMSans_500Medium' },
  service: { fontStyle: 'italic' },
  icon: { flexShrink: 0 },
  thumbnail: { width: 20, height: 20, borderRadius: 4, flexShrink: 0 },
});
