export const MESSAGE_EDIT_WINDOW_MS = 15 * 60_000;

type EditableMessage = {
  senderId: string; type?: string; sentAt: string; content: string;
  localStatus?: string | null; isDeleted?: boolean;
};

export function canEditMessage(message: EditableMessage, userId?: string, now = Date.now()): boolean {
  const age = now - Date.parse(message.sentAt);
  return Boolean(userId && message.senderId === userId && !message.localStatus && !message.isDeleted
    && message.type !== 'voice' && message.type !== 'service' && message.content.trim()
    && Number.isFinite(age) && age >= 0 && age <= MESSAGE_EDIT_WINDOW_MS);
}

export function canSaveMessageEdit(original: string, next: string): boolean {
  const content = next.trim();
  return content.length > 0 && content.length <= 2000 && content !== original.trim();
}
