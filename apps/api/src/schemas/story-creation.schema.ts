import { z } from 'zod';
import { storyCompositionSchema } from './story-composition.schema';

const uuid = z.string().uuid();

export const storyBatchCreateSchema = z.object({
  body: z.object({
    batchId: uuid,
    /** Your audience (followers and matches) or Close Friends only. Every item in a batch shares it. */
    audience: z.enum(['followers', 'close_friends']).default('followers'),
    items: z.array(z.object({
      itemId: uuid,
      kind: z.enum(['photo', 'video']),
      size: z.number().int().positive().optional(),
      durationMs: z.number().int().positive(),
      partIndex: z.number().int().positive().optional(),
      partCount: z.number().int().positive().optional(),
      composition: storyCompositionSchema,
    }).strict()).min(1).max(20),
  }).strict(),
});

export const storyBatchParamsSchema = z.object({ params: z.object({ batchId: uuid }) });
export const storyBatchItemParamsSchema = z.object({ params: z.object({ batchId: uuid, itemId: uuid }) });

export const storyBatchPartsSchema = z.object({
  params: z.object({ batchId: uuid, itemId: uuid }),
  body: z.object({
    size: z.number().int().positive().optional(),
    restart: z.boolean().optional(),
  }).strict().default({}),
});

export const storyPersonParamsSchema = z.object({ params: z.object({ userId: uuid }) });
export const storyAddYoursParamsSchema = z.object({ params: z.object({ threadId: uuid }) });
export const storyCaptionParamsSchema = z.object({ params: z.object({ jobId: uuid }) });

export const storyStickerParamsSchema =z.object({ params: z.object({ storyId: uuid, stickerId: uuid }) });

export const storyStickerResponseSchema = z.object({
  params: z.object({ storyId: uuid, stickerId: uuid }),
  body: z.object({
    option: z.number().int().min(0).max(3).optional(),
    value: z.number().min(0).max(1).optional(),
    text: z.string().max(300).optional(),
    subscribe: z.boolean().optional(),
  }).strict(),
});
