import type { SelectedChatMedia } from './components/attachmentTypes';

type Request = { selected: SelectedChatMedia[]; onResult: (items: SelectedChatMedia[] | null) => void };
const requests = new Map<string, Request>();
let nextId = 0;

export function createAttachmentPickerRequest(selected: SelectedChatMedia[], onResult: Request['onResult']) {
  const id = `chat-attachments-${++nextId}`;
  requests.set(id, { selected, onResult });
  return id;
}
export function attachmentPickerSelection(id: string) { return requests.get(id)?.selected ?? []; }
export function finishAttachmentPickerRequest(id: string, items: SelectedChatMedia[] | null) {
  const request = requests.get(id);
  requests.delete(id);
  request?.onResult(items);
}
export function cancelAttachmentPickerRequest(id: string) { requests.delete(id); }
