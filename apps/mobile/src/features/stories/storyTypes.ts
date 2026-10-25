import type { StoryServerComposition } from './create/composition/types';

/** `blueBadge`: college and selfie both verified - shown beside the name. */
export type StoryOwner = { id: string; name: string; avatarUrl: string | null; blueBadge?: boolean };

export type TrayStory = {
  id: string;
  ownerId: string;
  contentType: string;
  caption: string | null;
  publishedAt: string;
  expiresAt: string;
  seen: boolean;
  liked: boolean;
  /** How long the Story shows: a photo's chosen duration or the video's length. Null on older Stories. */
  durationMs?: number | null;
  /** Interactive stickers and music, drawn live over the media. */
  composition?: StoryServerComposition | null;
  /** "Your story" (followers and matches) or Close Friends only. Absent on older responses. */
  audience?: 'followers' | 'close_friends';
  /** Only on your own Stories. */
  viewCount?: number;
  likeCount?: number;
  /** Demo Stories only: the media itself, shown without asking the server. */
  mediaUrl?: string;
};

/** One person's active Stories, oldest first, as `GET /stories/tray` returns them. */
export type TrayGroup = {
  owner: StoryOwner;
  isOwn: boolean;
  hasUnseen: boolean;
  /** An unseen Close Friends Story: a green ring, and first in the tray. */
  closeFriendsUnseen?: boolean;
  firstUnseenIndex: number;
  latestPublishedAt: string;
  /** Whether you may reply and react. Absent (demo, older responses) means you may. */
  canReply?: boolean;
  /** Why not: replies are off (or limited to a list you are not on), or you have not matched. */
  replyBlockedReason?: 'own' | 'off' | 'not_matched' | null;
  /** Set only when you have matched with this owner - the one place "view profile" can send you (section 17.3). Null on your own Stories, a follower you have not matched, demo, and older responses. */
  matchId?: string | null;
  stories: TrayStory[];
};

export type StoryTray = { groups: TrayGroup[] };

export const STORY_TRAY_QUERY_KEY = ['stories', 'tray'] as const;
