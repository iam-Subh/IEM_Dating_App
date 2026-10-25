import type { Message } from '../../store/chatSlice';

/** Retry stays attached to the original message, for every content format. */
export function messageSendFailure(message: Pick<Message, 'senderId' | 'type' | 'localStatus' | 'localError'>, currentUserId: string) {
  if (message.senderId !== currentUserId || message.type === 'service') return null;
  if (message.localStatus !== 'failed' && !(message.localStatus === 'queued' && message.localError)) return null;
  return {
    label: message.localStatus === 'failed' ? 'Not sent' : 'Waiting to send',
    detail: message.localError || 'Check your connection and try again.',
  };
}

/** Completed uploads keep their keys when only the final send needs retry. */
export function mediaRetryIndexes(mediaKeys: Array<string | null>, itemIndex?: number): number[] {
  if (itemIndex === undefined) return mediaKeys.flatMap((key, index) => key ? [] : [index]);
  return Number.isInteger(itemIndex) && itemIndex >= 0 && itemIndex < mediaKeys.length && !mediaKeys[itemIndex] ? [itemIndex] : [];
}

export function mediaTicketsExpired(error: unknown): boolean {
  const data = (error as { response?: { data?: { code?: string; error?: { code?: string } } } } | undefined)?.response?.data;
  return (data?.code ?? data?.error?.code) === 'INVALID_MEDIA_TICKET';
}
