export type ProfileVideoSource = 'camera' | 'library';
const requests = new Map<string, ProfileVideoSource | null>();
let nextId = 0;

export function createVideoSourceRequest(): string {
  const id = `profile-video-${++nextId}`;
  requests.set(id, null);
  return id;
}

export function selectVideoSource(id: string, source: ProfileVideoSource): void {
  if (requests.has(id)) requests.set(id, source);
}

export function takeVideoSource(id: string): ProfileVideoSource | null {
  const source = requests.get(id) ?? null;
  requests.delete(id);
  return source;
}
