import type { StoryAudience } from '../../settings/storySettings';

export type StoryShareChoice = StoryAudience | 'edit_close_friends' | null;
type Request = {
  count: number;
  avatar: string | null;
  canEditCloseFriends: boolean;
  onResult: (choice: StoryShareChoice) => void;
};
const requests = new Map<string, Request>();
let nextId = 0;

export function createStoryShareRequest(request: Request) {
  const id = `story-share-${++nextId}`;
  requests.set(id, request);
  return id;
}
export function storyShareRequest(id: string) { return requests.get(id); }
export function finishStoryShareRequest(id: string, choice: StoryShareChoice) {
  const request = requests.get(id);
  requests.delete(id);
  request?.onResult(choice);
}
export function cancelStoryShareRequest(id: string) { requests.delete(id); }
