type DiscardRequest = (discard: boolean) => void;

const requests = new Map<string, DiscardRequest>();
let nextId = 0;

/** Keep callbacks outside navigation parameters, which must remain serializable. */
export function createDiscardRequest(onResult: DiscardRequest): string {
  const id = `discard-${++nextId}`;
  requests.set(id, onResult);
  return id;
}

export function finishDiscardRequest(id: string, discard: boolean): void {
  const onResult = requests.get(id);
  requests.delete(id);
  onResult?.(discard);
}

export function cancelDiscardRequest(id: string): void {
  requests.delete(id);
}
