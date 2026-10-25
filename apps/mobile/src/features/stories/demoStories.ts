import { demoProfiles } from '../discovery/demo/demoProfiles';
import { orderTray } from './storyNavigation';
import { registerStorySource } from './storySources';
import type { TrayGroup, TrayStory } from './storyTypes';

/**
 * Stories for demo mode: the demo profiles' photos as their Stories, with no
 * server involved. Media URLs are registered up front, so the viewer finds
 * them exactly where it looks for real Stories.
 */

const HOUR = 60 * 60 * 1000;
/**
 * A public 10 second sample, so a video Story, its sound and its progress can be
 * tried. (Google's sample bucket, used before, now answers 403.)
 */
const SAMPLE_VIDEO = 'https://test-videos.co.uk/vids/bigbuckbunny/mp4/h264/360/Big_Buck_Bunny_360_10s_1MB.mp4';
const CAPTIONS = ['Campus sunsets hit different 🌅', 'Library grind ☕', null, 'Weekend plans?'];

export const DEMO_VIEWERS = demoProfiles.map((person, index) => ({
  id: `demo-view-${person.id}`,
  viewerId: `demo-${person.id}`,
  viewer: { id: `demo-${person.id}`, name: person.name, avatarUrl: person.primaryPhoto ?? person.photos[0] ?? null, blueBadge: !!person.blueBadge },
  liked: index % 3 === 0,
}));

function makeStory(ownerId: string, id: string, url: string, contentType: string, hoursAgo: number, now: number, extra: Partial<TrayStory> = {}): TrayStory {
  registerStorySource(id, { url, thumbnailUrl: null, contentType, expiresAt: Number.MAX_SAFE_INTEGER });
  const publishedAt = now - hoursAgo * HOUR;
  return {
    id,
    ownerId,
    contentType,
    caption: null,
    publishedAt: new Date(publishedAt).toISOString(),
    expiresAt: new Date(publishedAt + 24 * HOUR).toISOString(),
    seen: false,
    liked: false,
    mediaUrl: url,
    ...extra,
  };
}

function group(owner: TrayGroup['owner'], stories: TrayStory[], isOwn = false): TrayGroup {
  const firstUnseen = stories.findIndex((story) => !story.seen);
  return {
    owner,
    isOwn,
    hasUnseen: firstUnseen >= 0,
    closeFriendsUnseen: stories.some((story) => !story.seen && story.audience === 'close_friends'),
    firstUnseenIndex: Math.max(0, firstUnseen),
    latestPublishedAt: stories[stories.length - 1].publishedAt,
    stories,
  };
}

export function buildDemoStoryGroups(ownAvatarUrl: string | null, now = Date.now()): TrayGroup[] {
  const people = demoProfiles.filter((person) => person.photos.length || person.primaryPhoto);
  const others = people.map((person, index) => {
    const ownerId = `demo-${person.id}`;
    const media = (person.photos.length ? person.photos : [person.primaryPhoto!]).slice(0, 3);
    const stories = media.map((url, position) => makeStory(
      ownerId, `demo-${person.id}-${position}`, url, 'image/jpeg', index * 1.5 + 3 - position * 0.5, now,
      { caption: position === 0 ? CAPTIONS[index % CAPTIONS.length] : null },
    ));
    if (index === 0) {
      stories.push(makeStory(ownerId, `demo-${person.id}-video`, SAMPLE_VIDEO, 'video/mp4', 0.5, now, { caption: 'A video Story: tap the speaker to mute' }));
    }
    // The last two people are already watched, so the tray shows grey rings,
    // and the second has seen only their first Story, so it opens on the next.
    const watched = index >= people.length - 2;
    const marked = stories.map((story, position) => ({ ...story, seen: watched || (index === 1 && position === 0) }));
    // The third person shared a Close Friends story with you: a green ring, first in the tray.
    const shared = index === 2
      ? marked.map((story, position) => (position === marked.length - 1 ? { ...story, audience: 'close_friends' as const, seen: false } : story))
      : marked;
    return group({ id: ownerId, name: person.name, avatarUrl: person.primaryPhoto ?? person.photos[0] ?? null, blueBadge: !!person.blueBadge }, shared);
  });

  const ownPhoto = people[0]?.photos[1] ?? people[0]?.primaryPhoto;
  const own = ownPhoto
    ? [group(
      { id: 'demo-me', name: 'You', avatarUrl: ownAvatarUrl },
      [makeStory('demo-me', 'demo-me-0', ownPhoto, 'image/jpeg', 2, now, {
        seen: true,
        caption: 'Your demo Story',
        viewCount: DEMO_VIEWERS.length,
        likeCount: DEMO_VIEWERS.filter((viewer) => viewer.liked).length,
      })],
      true,
    )]
    : [];
  return orderTray([...own, ...others]);
}
