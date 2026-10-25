import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../services/api';
import { chatMarksKey, type MarkedMessage, type MarkKind } from './messageMarks';

/** Read in pages so older saved messages remain accessible. */
async function loadMarks(matchId: string, kind: MarkKind, signal: AbortSignal) {
  const messages: MarkedMessage[] = [];
  let before = '';
  do {
    const response = await api.get(`/chat/${matchId}/marks/${kind}${before}`, { signal });
    const page = response.data.data as MarkedMessage[];
    messages.push(...page);
    if (page.length < 100) break;
    const last = page[page.length - 1];
    before = `?beforeAt=${encodeURIComponent(last.markedAt)}&beforeId=${encodeURIComponent(last.id)}`;
  } while (!signal.aborted);
  return messages;
}

export function useChatMarks(userId: string | undefined, matchId: string, kind: MarkKind, enabled: boolean) {
  const query = useQuery({ queryKey: chatMarksKey(userId, matchId, kind),
    queryFn: ({ signal }) => loadMarks(matchId, kind, signal), enabled: Boolean(userId) && enabled,
    staleTime: 15_000 });
  useEffect(() => {
    if (!enabled) return;
    const expires = (query.data ?? []).map(message => Date.parse(message.expiresAt ?? '')).filter(Number.isFinite);
    if (!expires.length) return;
    const timer = setTimeout(() => { void query.refetch(); }, Math.min(2_147_483_647, Math.max(10, Math.min(...expires) - Date.now() + 20)));
    return () => clearTimeout(timer);
  }, [enabled, query.data, query.refetch]);
  return query;
}
