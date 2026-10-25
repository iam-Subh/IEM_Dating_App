// Limit speculative image requests. In-flight native requests cannot be cancelled.
export const MEDIA_POLICY = {
  preparedCards: 3,
  imageConcurrency: 2,
  rememberedImages: 128,
  activeBufferSeconds: 10,
  warmBufferSeconds: 2,
  activeBufferBytes: 16 * 1024 * 1024,
  warmBufferBytes: 4 * 1024 * 1024,
} as const;

export function createImagePreparation(
  fetchImage: (uri: string) => Promise<unknown>,
  onChange: () => void = () => {},
) {
  let queue: string[] = [];
  const running = new Set<string>();
  const completed = new Set<string>();
  const failedUntil = new Map<string, number>();
  function pump() {
    while (running.size < MEDIA_POLICY.imageConcurrency && queue.length) {
      const uri = queue.shift()!;
      if (
        running.has(uri) ||
        completed.has(uri) ||
        (failedUntil.get(uri) ?? 0) > Date.now()
      )
        continue;
      running.add(uri);
      Promise.resolve()
        .then(() => fetchImage(uri))
        .then(() => {
          completed.add(uri);
          failedUntil.delete(uri);
          if (completed.size > MEDIA_POLICY.rememberedImages)
            completed.delete(completed.values().next().value!);
        })
        .catch(() => {
          failedUntil.set(uri, Date.now() + 15000);
          if (failedUntil.size > MEDIA_POLICY.rememberedImages)
            failedUntil.delete(failedUntil.keys().next().value!);
        })
        .finally(() => {
          running.delete(uri);
          pump();
          onChange();
        });
    }
  }
  return {
    isPrepared(uris: string[]) {
      return uris.every((uri) => completed.has(uri));
    },
    update(uris: Array<string | null | undefined>) {
      queue = [...new Set(uris.filter((uri): uri is string => !!uri))];
      pump();
    },
    stop() {
      queue = [];
    },
  };
}

export function photoPreparationWindow(
  cards: Array<{
    photos?: string[];
    primaryPhoto?: string | null;
    video?: string | null;
    videoPoster?: string | null;
  }>,
  selectedPhoto?: string,
): string[] {
  const photos = (index: number) => {
    const card = cards[index];
    return card?.photos?.length
      ? card.photos
      : card?.primaryPhoto
        ? [card.primaryPhoto]
        : [];
  };
  // A card that opens on its video shows the poster first, so it comes first.
  const poster = (index: number) => {
    const card = cards[index];
    return card?.video && card.videoPoster ? [card.videoPoster] : [];
  };
  const current = photos(0);
  const selected = selectedPhoto ? current.indexOf(selectedPhoto) : -1;
  return [
    ...new Set([
      ...poster(0),
      ...current.slice(0, 2),
      ...(selected >= 0 ? current.slice(selected, selected + 2) : []),
      ...poster(1),
      ...photos(1).slice(0, 2),
      ...photos(2).slice(0, 1),
    ]),
  ];
}
