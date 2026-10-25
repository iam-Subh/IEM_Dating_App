/**
 * The story being made, as one scene on a 1080 × 1920 canvas.
 *
 * Every layer's position is in canvas units, so a story looks the same on any
 * phone. Decorative layers (text, drawing, emoji, GIF, time, photo stickers) are
 * baked into the uploaded media; interactive stickers and music are sent to the
 * server as data and drawn live by the viewer. See STORY_CREATION_SPEC.md §12.
 */

export const CANVAS = { width: 1080, height: 1920 } as const;

export type Transform = { x: number; y: number; scale: number; rotation: number };

export const CENTER: Transform = { x: CANVAS.width / 2, y: CANVAS.height / 2, scale: 1, rotation: 0 };

export type FontId =
  | 'classic' | 'modern' | 'neon' | 'typewriter' | 'strong'
  | 'signature' | 'editor' | 'bubble' | 'squeeze' | 'poster' | 'deco' | 'elegant';

export type TextLayer = {
  id: string;
  kind: 'text';
  text: string;
  font: FontId;
  color: string;
  /** Highlight behind each line. */
  background: 'none' | 'solid' | 'translucent';
  align: 'left' | 'center' | 'right';
  /** Font size in canvas units. */
  size: number;
  /** Animated text is drawn live by the viewer instead of baked into the media. */
  animation?: TextAnimation;
  /**
   * The line width the text was typed at, in canvas units: lines break where
   * they broke while typing, after Done and for every viewer (Instagram).
   * Absent on text from before this existed: the old 960.
   */
  wrap?: number;
  transform: Transform;
};

export type TextAnimation = 'typewriter' | 'pop' | 'bounce' | 'pulse';

export type EmojiLayer = { id: string; kind: 'emoji'; emoji: string; transform: Transform };
export type GifLayer = { id: string; kind: 'gif'; url: string; width: number; height: number; transform: Transform };
export type TimeLayer = { id: string; kind: 'time'; style: 0 | 1 | 2; date: string; transform: Transform };
export type PhotoStickerLayer = {
  id: string;
  kind: 'photo';
  uri: string;
  width: number;
  height: number;
  /** `cutout`: a subject on a transparent background, drawn without a frame. */
  shape: 'rounded' | 'circle' | 'square' | 'cutout';
  transform: Transform;
};

export type BrushId = 'pen' | 'arrow' | 'marker' | 'neon' | 'highlighter' | 'eraser' | 'fill';

export type DrawingStroke = {
  brush: BrushId;
  color: string;
  /** Stroke width in canvas units. */
  width: number;
  /** Flat x, y pairs in canvas units. Empty for a fill. */
  points: number[];
};

type StickerBase = { id: string; transform: Transform; style: string };

export type CaptionSegment = { startMs: number; endMs: number; text: string };

export type InteractiveSticker =
  | (StickerBase & { type: 'mention'; userId: string; name: string })
  | (StickerBase & { type: 'location'; placeId: string; name: string })
  | (StickerBase & { type: 'hashtag'; tag: string })
  | (StickerBase & { type: 'link'; url: string; label?: string })
  | (StickerBase & { type: 'poll'; question: string; options: string[] })
  | (StickerBase & { type: 'quiz'; question: string; options: string[]; correctIndex: number })
  | (StickerBase & { type: 'question'; prompt: string })
  | (StickerBase & { type: 'slider'; question: string; emoji: string })
  | (StickerBase & { type: 'countdown'; title: string; endsAt: string })
  /** A GIPHY GIF, drawn live (not baked into the media) so it keeps animating. */
  | (StickerBase & { type: 'gif'; url: string; width: number; height: number })
  /**
   * Where a Frames layer's photo is, so the viewer can cover it until it is
   * developed. Made from the frame layer when sharing, never added directly.
   */
  | (StickerBase & { type: 'frame'; width: number; height: number })
  /** Blurs the whole story for a viewer until they message its owner. */
  | (StickerBase & { type: 'reveal'; hint: string })
  /** A prompt others answer with their own story. `threadId` is set once the first story posts. */
  | (StickerBase & { type: 'addYours'; prompt: string; threadId?: string; music?: boolean })
  /** Auto captions for a video, in time with it (ms from the story's start). */
  | (StickerBase & { type: 'captions'; segments: CaptionSegment[] })
  /** Animated text, made from a text layer when sharing. */
  | (StickerBase & Pick<TextLayer, 'text' | 'font' | 'color' | 'background' | 'align' | 'size' | 'wrap'> & { type: 'text'; animation: TextAnimation });

export type InteractiveStickerType = InteractiveSticker['type'];

export type StickerLayer = { id: string; kind: 'sticker'; sticker: InteractiveSticker };

/** A question reply shared as a story: the question on top, the reply below, the asker not shown. */
export type ReplyCardLayer = { id: string; kind: 'replyCard'; prompt: string; text: string; transform: Transform };

/** Frames: a photo in an instant-print frame with a caption. `width` and `height` are the photo's. */
export type FrameLayer = { id: string; kind: 'frame'; uri: string; width: number; height: number; caption: string; transform: Transform };

export type Layer = TextLayer | EmojiLayer | GifLayer | TimeLayer | PhotoStickerLayer | StickerLayer | ReplyCardLayer | FrameLayer;

export type MusicDisplay = 'lyrics' | 'album' | 'title' | 'hidden';

export type StoryMusic = {
  provider: 'jiosaavn';
  trackId: string;
  title: string;
  artists: string;
  artworkUrl?: string | null;
  startMs: number;
  lengthMs: number;
  display: MusicDisplay;
  lyricStyle?: string;
  color?: string;
  videoVolume?: number;
  musicVolume?: number;
  transform?: Transform;
};

/** What the server stores and the viewer draws. */
export type StoryServerComposition = {
  version: 1;
  interactive: InteractiveSticker[];
  music?: StoryMusic | null;
};

/** A song as the music API returns it. */
export type MusicTrack = {
  provider: 'jiosaavn';
  id: string;
  title: string;
  artists: string;
  album: string | null;
  durationMs: number;
  language: string | null;
  explicit: boolean;
  artwork: { small: string | null; medium: string | null; large: string | null };
  streams: { preview: string | null; standard: string | null };
  sourceUrl: string | null;
};

export type LyricLine = { startMs: number; endMs: number; text: string };

export type MediaSource = {
  kind: 'photo' | 'video';
  /** A local file URI. Photos are normalised (orientation applied, size capped) on import. */
  uri: string;
  width: number;
  height: number;
  durationMs?: number;
  hasAudio?: boolean;
  /**
   * Straight from the camera: shown at once, orientation still in EXIF.
   * Normalised (orientation applied, size capped) when the story is shared.
   */
  raw?: boolean;
  /** A Create-mode background: it fills the story and cannot be moved or resized. */
  locked?: boolean;
  /** A Boomerang: the short clip it was made from, so its style can change. */
  boomerang?: { sourceUri: string; style: 'classic' | 'slomo' | 'echo' | 'duo' };
  /** A photo effect, and the photo before it, so it can change or be removed. */
  effect?: 'blur' | 'mono' | 'studio' | 'glasses' | 'crown' | 'hearts';
  original?: { uri: string; width: number; height: number };
};

/** One story in the editor, also what a draft saves. */
export type StoryDraftItem = {
  id: string;
  media: MediaSource;
  mediaTransform: Transform;
  fitMode: 'cover' | 'contain';
  /** One colour, or several for a top-to-bottom gradient. */
  background: string[];
  filterId: string;
  /** How long a photo shows, 1–15 s. Ignored for videos and for photos with music. */
  photoDurationMs: number;
  trim: { startMs: number; endMs: number } | null;
  muted: boolean;
  layers: Layer[];
  drawing: DrawingStroke[];
  music: (StoryMusic & { track: MusicTrack }) | null;
};

export const PHOTO_DEFAULT_MS = 5000;
export const PHOTO_MIN_MS = 1000;
export const PHOTO_MAX_MS = 15_000;
export const VIDEO_PART_MS = 60_000;
export const MAX_SELECTION = 10;
