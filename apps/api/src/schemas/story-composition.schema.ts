import { z } from 'zod';

/** Canvas units: the story is composed on a 1080 × 1920 canvas. */
const transform = z.object({
  x: z.number().finite().min(-1080).max(2160),
  y: z.number().finite().min(-1920).max(3840),
  scale: z.number().finite().min(0.05).max(20),
  rotation: z.number().finite().min(-3600).max(3600),
}).strict();

const stickerId = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);
const style = z.string().max(40).default('default');
const label = (max: number) => z.string().trim().min(1).max(max);

const option = label(40);

export const interactiveStickerSchema = z.discriminatedUnion('type', [
  z.object({ id: stickerId, type: z.literal('mention'), userId: z.string().uuid(), name: z.string().trim().max(100), transform, style }).strict(),
  z.object({ id: stickerId, type: z.literal('location'), placeId: z.string().max(120), name: label(120), transform, style }).strict(),
  z.object({ id: stickerId, type: z.literal('hashtag'), tag: z.string().regex(/^[\p{L}\p{N}_]{1,60}$/u), transform, style }).strict(),
  z.object({ id: stickerId, type: z.literal('link'), url: z.string().trim().min(1).max(2048), label: z.string().trim().max(40).optional(), transform, style }).strict(),
  z.object({ id: stickerId, type: z.literal('poll'), question: z.string().trim().max(120).default(''), options: z.array(option).min(2).max(4), transform, style }).strict(),
  z.object({ id: stickerId, type: z.literal('quiz'), question: label(120), options: z.array(option).min(2).max(4), correctIndex: z.number().int().min(0).max(3), transform, style }).strict(),
  z.object({ id: stickerId, type: z.literal('question'), prompt: label(120), transform, style }).strict(),
  z.object({ id: stickerId, type: z.literal('slider'), question: z.string().trim().max(120).default(''), emoji: z.string().min(1).max(16), transform, style }).strict(),
  z.object({ id: stickerId, type: z.literal('countdown'), title: label(40), endsAt: z.string().datetime(), transform, style }).strict(),
  // Drawn live by the viewer so it keeps animating; only GIPHY's own media hosts.
  z.object({
    id: stickerId,
    type: z.literal('gif'),
    url: z.string().max(1000).regex(/^https:\/\/(media\d?\.giphy\.com|i\.giphy\.com)\//),
    width: z.number().positive().max(2000),
    height: z.number().positive().max(2000),
    transform,
    style,
  }).strict(),
  // An instant photo baked into the media. `width` and `height` are the photo's
  // own size inside the frame; the viewer covers it until it is developed.
  z.object({ id: stickerId, type: z.literal('frame'), width: z.number().positive().max(1080), height: z.number().positive().max(1920), transform, style }).strict(),
  // The whole Story is blurred for a viewer until they message its owner.
  z.object({ id: stickerId, type: z.literal('reveal'), hint: z.string().trim().max(60).default(''), transform, style }).strict(),
  // A prompt others answer with their own story. Without a thread id it starts a new thread.
  // Auto captions for a video, shown in time with it. Times are from the story's start.
  z.object({
    id: stickerId,
    type: z.literal('captions'),
    segments: z.array(z.object({
      startMs: z.number().int().min(0).max(3_600_000),
      endMs: z.number().int().min(0).max(3_600_000),
      text: z.string().trim().min(1).max(160),
    }).strict()).max(400),
    transform,
    style,
  }).strict(),
  // Animated text, drawn live so it can move.
  z.object({
    id: stickerId,
    type: z.literal('text'),
    text: z.string().min(1).max(2200),
    font: z.string().regex(/^[a-z]{1,20}$/),
    color: z.string().regex(/^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/),
    background: z.enum(['none', 'solid', 'translucent']),
    align: z.enum(['left', 'center', 'right']),
    size: z.number().min(10).max(400),
    animation: z.enum(['typewriter', 'pop', 'bounce', 'pulse']),
    /** The line width it was typed at, in canvas units, so lines break as they did while typing. */
    wrap: z.number().int().min(100).max(1080).optional(),
    transform,
    style,
  }).strict(),
  z.object({ id: stickerId, type: z.literal('addYours'), prompt: label(80), threadId: z.string().uuid().optional(), music: z.boolean().optional(), transform, style }).strict(),
]);

/** The Reveal sticker of a stored composition, if it has one. */
export function revealOf(composition: unknown): { hint: string } | null {
  const interactive = (composition as { interactive?: unknown } | null)?.interactive;
  if (!Array.isArray(interactive)) return null;
  const sticker = interactive.find((entry) => (entry as { type?: unknown })?.type === 'reveal') as { hint?: unknown } | undefined;
  return sticker ? { hint: typeof sticker.hint === 'string' ? sticker.hint : '' } : null;
}

export type InteractiveSticker = z.infer<typeof interactiveStickerSchema>;

export const storyMusicSchema = z.object({
  provider: z.literal('jiosaavn'),
  trackId: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/),
  title: z.string().trim().min(1).max(300),
  artists: z.string().trim().max(500),
  artworkUrl: z.string().url().max(1000).nullable().optional(),
  startMs: z.number().int().min(0).max(60 * 60 * 1000),
  lengthMs: z.number().int().min(1000).max(60_000),
  display: z.enum(['lyrics', 'album', 'title', 'hidden']),
  lyricStyle: z.string().max(40).optional(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  videoVolume: z.number().min(0).max(1).optional(),
  musicVolume: z.number().min(0).max(1).optional(),
  transform: transform.optional(),
}).strict();

export type StoryMusic = z.infer<typeof storyMusicSchema>;

/**
 * The part of a Story's composition the server keeps: what the viewer draws
 * live. Text, drawings and decorative stickers are already in the media.
 */
export const storyCompositionSchema = z.object({
  version: z.literal(1),
  interactive: z.array(interactiveStickerSchema).max(20).default([]),
  music: storyMusicSchema.nullable().optional(),
}).strict().superRefine((composition, context) => {
  const ids = new Set<string>();
  if (composition.interactive.filter((sticker) => sticker.type === 'reveal').length > 1) {
    context.addIssue({ code: 'custom', path: ['interactive'], message: 'A story can have one Reveal sticker' });
  }
  if (composition.interactive.filter((sticker) => sticker.type === 'addYours').length > 1) {
    context.addIssue({ code: 'custom', path: ['interactive'], message: 'A story can have one Add Yours sticker' });
  }
  composition.interactive.forEach((sticker, index) => {
    if (ids.has(sticker.id)) context.addIssue({ code: 'custom', path: ['interactive', index, 'id'], message: 'Sticker ids must be unique' });
    ids.add(sticker.id);
    if (sticker.type === 'quiz' && sticker.correctIndex >= sticker.options.length) {
      context.addIssue({ code: 'custom', path: ['interactive', index, 'correctIndex'], message: 'The correct answer must be one of the options' });
    }
    if (sticker.type === 'countdown') {
      const endsAt = Date.parse(sticker.endsAt);
      if (endsAt < Date.now() - 60_000 || endsAt > Date.now() + 366 * 24 * 60 * 60_000) {
        context.addIssue({ code: 'custom', path: ['interactive', index, 'endsAt'], message: 'A countdown must end within the next year' });
      }
    }
  });
});

export type StoryComposition = z.infer<typeof storyCompositionSchema>;
