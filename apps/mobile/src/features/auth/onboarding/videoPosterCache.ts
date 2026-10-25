export type VideoPoster = {uri: string; duration: number};

/** Share thumbnail requests and reuse finished images across screen mounts. */
export function createVideoPosterCache(load: (uri: string) => Promise<VideoPoster>, limit = 24) {
  const images = new Map<string, VideoPoster>();
  const pending = new Map<string, Promise<VideoPoster>>();
  const read = (uri: string) => {
    const image = images.get(uri);
    if (image) {images.delete(uri); images.set(uri, image);}
    return image;
  };
  const store = (uri: string, image: VideoPoster) => {
    images.delete(uri); images.set(uri, image);
    while (images.size > limit) images.delete(images.keys().next().value!);
    return image;
  };
  const remember = (uri: string, request: Promise<VideoPoster>) => {
    const task = request.then(image => store(uri, image)).finally(() => {
      if (pending.get(uri) === task) pending.delete(uri);
    });
    pending.set(uri, task);
    return task;
  };
  return {
    read,
    get(uri: string): Promise<VideoPoster> {
      const image = read(uri);
      if (image) return Promise.resolve(image);
      return pending.get(uri) ?? remember(uri, Promise.resolve().then(() => load(uri)));
    },
    copy(from: string, to: string) {
      if (from === to) return;
      const image = read(from);
      if (image) {store(to, image); return;}
      const request = pending.get(from);
      if (request) void remember(to, request).catch(() => {});
    },
  };
}
