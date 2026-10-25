export type ProfilePhotoOption = 'crop' | 'replace' | 'remove';
type Request = { photoId: string; action: ProfilePhotoOption | null };
const requests = new Map<string, Request>();
let nextId = 0;

export function createPhotoOptionsRequest(photoId: string): string {
  const id = `profile-photo-${++nextId}`;
  requests.set(id, { photoId, action: null });
  return id;
}

export function selectPhotoOption(id: string, action: ProfilePhotoOption): void {
  const request = requests.get(id);
  if (request) requests.set(id, { ...request, action });
}

export function takePhotoOption(id: string): { photoId: string; action: ProfilePhotoOption } | null {
  const request = requests.get(id);
  requests.delete(id);
  return request?.action ? { photoId: request.photoId, action: request.action } : null;
}
