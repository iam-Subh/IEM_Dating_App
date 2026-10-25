import { useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../../services/api';

/**
 * Story settings and the private lists behind them (STORY_AUDIENCE_SPEC.md):
 * who can reply and mention you, resharing, screenshot blocking, Close
 * Friends, Hide story from, and muted authors.
 */

export type StoryReplies = 'matches' | 'close_friends' | 'off';
export type StoryMentions = 'everyone' | 'following' | 'off';
export type StoryAudience = 'followers' | 'close_friends';
export type AudienceList = 'close_friends' | 'hidden';

export type StorySettingsCounts = {
  closeFriends: number;
  hidden: number;
  muted: number;
  followers: number;
  following: number;
  followRequests: number;
};

export type StorySettings = {
  storiesEnabled: boolean;
  allowFollowRequests: boolean;
  replies: StoryReplies;
  mentions: StoryMentions;
  resharing: boolean;
  screenshotBlock: boolean;
  /** Part 3: keep a Story privately in the Archive after it ends. */
  archive: boolean;
  /** Part 3: save every Story to the device gallery the moment it is shared. */
  saveToGallery: boolean;
  /** Your follower and following counts show on your profile in Search. */
  showFollowerCount: boolean;
  counts?: StorySettingsCounts;
};

export type StorySettingsChange = Partial<Omit<StorySettings, 'counts'>>;

export type AudiencePerson = {
  id: string;
  name: string;
  avatarUrl: string | null;
  onList?: boolean;
  isMatch: boolean;
  followsYou: boolean;
  /** False when someone on a list no longer follows you or matches: they see nothing. */
  inAudience: boolean;
};

export type PersonPage = { people: AudiencePerson[]; nextCursor: string | null; total: number };

export const STORY_SETTINGS_QUERY_KEY = ['stories', 'settings'] as const;

export const REPLY_LABELS: Record<StoryReplies, string> = { matches: 'Your matches', close_friends: 'Close Friends', off: 'Off' };
export const MENTION_LABELS: Record<StoryMentions, string> = { everyone: 'Everyone', following: 'People you follow', off: 'No one' };

/** The accent of each list: Instagram's Close Friends green, and blue for hiding. */
export const CLOSE_FRIENDS_GREEN = '#1DBF3A';
export const HIDDEN_BLUE = '#3897F0';

export function useStorySettings(enabled = true) {
  return useQuery({
    queryKey: STORY_SETTINGS_QUERY_KEY,
    queryFn: async () => (await api.get('/stories/settings')).data.data as StorySettings,
    staleTime: 60_000,
    enabled,
  });
}

/** Saves a change at once and shows it straight away, rolling back if the server refuses. */
export function useUpdateStorySettings() {
  const queryClient = useQueryClient();
  const queue = useRef(Promise.resolve());
  const revisions = useRef<Partial<Record<keyof StorySettingsChange, number>>>({});
  const confirmed = useRef<StorySettingsChange>({});
  const pending = useRef(new Set<keyof StorySettingsChange>());
  return (change: StorySettingsChange) => {
    const keys = Object.keys(change) as Array<keyof StorySettingsChange>;
    const previous = queryClient.getQueryData<StorySettings>(STORY_SETTINGS_QUERY_KEY);
    const versions = new Map(keys.map((key) => {
      if (!pending.current.has(key) && previous) Object.assign(confirmed.current, { [key]: previous[key] });
      pending.current.add(key);
      const version = (revisions.current[key] ?? 0) + 1;
      revisions.current[key] = version;
      return [key, version];
    }));
    // Stop an older read from replacing the displayed choice.
    void queryClient.cancelQueries({ queryKey: STORY_SETTINGS_QUERY_KEY });
    if (previous) queryClient.setQueryData<StorySettings>(STORY_SETTINGS_QUERY_KEY, { ...previous, ...change });
    const operation = queue.current.then(async () => {
      try {
        const saved = (await api.put('/stories/settings', change)).data.data as StorySettings;
        const accepted: StorySettingsChange = {};
        for (const key of keys) {
          const value = saved[key] ?? change[key];
          Object.assign(confirmed.current, { [key]: value });
          if (revisions.current[key] === versions.get(key)) Object.assign(accepted, { [key]: value });
        }
        // Merge only the changed fields. The response can contain old values for other switches.
        queryClient.setQueryData<StorySettings>(STORY_SETTINGS_QUERY_KEY, (current) => current ? { ...current, ...accepted } : saved);
      } catch (error) {
        const rollback: StorySettingsChange = {};
        for (const key of keys) {
          if (revisions.current[key] === versions.get(key) && confirmed.current[key] !== undefined) {
            Object.assign(rollback, { [key]: confirmed.current[key] });
          }
        }
        queryClient.setQueryData<StorySettings>(STORY_SETTINGS_QUERY_KEY, (current) => current ? { ...current, ...rollback } : current);
        throw error;
      } finally {
        for (const key of keys) if (revisions.current[key] === versions.get(key)) pending.current.delete(key);
      }
    });
    queue.current = operation.catch(() => undefined);
    return operation;
  };
}

const listPath = (list: AudienceList) => (list === 'close_friends' ? 'close-friends' : 'hidden');

export const storyAudienceApi = {
  people: async (list: AudienceList, q: string, cursor?: string | null): Promise<PersonPage> =>
    (await api.get('/stories/audience/people', { params: { list, q: q || undefined, cursor: cursor ?? undefined } })).data.data,
  add: (list: AudienceList, userId: string) => api.put(`/stories/${listPath(list)}/${userId}`),
  remove: (list: AudienceList, userId: string) => api.delete(`/stories/${listPath(list)}/${userId}`),
  clearCloseFriends: () => api.delete('/stories/close-friends'),
  /** Every id on your Close Friends list, across pages. */
  closeFriendIds: async (): Promise<Set<string>> => {
    const ids = new Set<string>();
    let cursor: string | null = null;
    for (let page = 0; page < 200; page += 1) {
      const data: PersonPage = (await api.get('/stories/close-friends', { params: { cursor: cursor ?? undefined } })).data.data;
      data.people.forEach((person) => ids.add(person.id));
      cursor = data.nextCursor;
      if (!cursor) break;
    }
    return ids;
  },
  muted: async (cursor?: string | null): Promise<PersonPage> =>
    (await api.get('/stories/muted', { params: { cursor: cursor ?? undefined } })).data.data,
  setMuted: (authorId: string, muted: boolean) => api.put(`/stories/authors/${authorId}/mute`, { muted }),
};

export type ArchiveItem = {
  id: string;
  stillUrl: string | null;
  contentType: string | null;
  publishedAt: string;
  audience: StoryAudience;
};

export type ArchivePage = { items: ArchiveItem[]; nextCursor: string | null };
export type CalendarDay = { date: string; count: number };

/** The owner's private Archive (STORY_ARCHIVE_SPEC.md): ended stories, a calendar, and On This Day. No Highlights. */
export const storyArchiveApi = {
  list: async (cursor?: string | null, date?: string | null): Promise<ArchivePage> =>
    (await api.get('/stories/archive', { params: { cursor: cursor ?? undefined, date: date ?? undefined } })).data.data,
  calendar: async (month: string): Promise<{ days: CalendarDay[] }> =>
    (await api.get('/stories/archive/calendar', { params: { month } })).data.data,
  memories: async (): Promise<{ items: ArchiveItem[] }> =>
    (await api.get('/stories/archive/memories')).data.data,
};

export type StoryInsights = {
  reach: number;
  views: number;
  forwardTaps: number;
  backTaps: number;
  nextStory: number;
  exits: number;
  replies: number;
  reactions: number;
  likes: number;
  stickerTaps: number;
  profileVisits: number;
  /** True once the 48-hour freeze has run (Phase C); the numbers above are frozen totals rather than live counts. */
  closed: boolean;
};

/** Insights for the owner's own Story (STORY_ARCHIVE_SPEC.md, section 7). */
export const storyInsightsApi = {
  get: async (storyId: string): Promise<StoryInsights> => (await api.get(`/stories/${storyId}/insights`)).data.data,
};

/** A readable message for a failed request. */
export function storyErrorMessage(error: any, fallback = 'Something went wrong. Try again.') {
  const message = error?.response?.data?.message;
  if (typeof message === 'string' && message) return message;
  return error?.response ? fallback : 'No connection. Try again.';
}
