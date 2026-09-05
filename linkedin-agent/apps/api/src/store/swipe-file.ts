import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { readJsonFile, writeJsonFile } from './json-store.js';

const FILE = 'swipe-file.json';

/**
 * Swipe-file entries record *patterns*, never another creator's words. The
 * schema has no field for copied text, and `copiedText: true` is rejected.
 */
export const swipeFileEntrySchema = z.object({
  id: z.string().min(1),
  sourceUrl: z.string().default(''),
  creator: z.string().default(''),
  capturedAt: z.string().min(1),
  format: z.enum(['text', 'image', 'document', 'story', 'audit']),
  hookPattern: z.string().default(''),
  structure: z.string().default(''),
  whyItWorks: z.string().default(''),
  audience: z.string().default(''),
  adaptationIdea: z.string().default(''),
  copiedText: z.literal(false).default(false),
});

export type SwipeFileEntry = z.infer<typeof swipeFileEntrySchema>;

export const swipeFileInputSchema = z.object({
  sourceUrl: z.string().default(''),
  creator: z.string().default(''),
  format: swipeFileEntrySchema.shape.format,
  hookPattern: z.string().default(''),
  structure: z.string().default(''),
  whyItWorks: z.string().default(''),
  audience: z.string().default(''),
  adaptationIdea: z.string().default(''),
  copiedText: z.boolean().default(false),
});

export type SwipeFileInput = z.infer<typeof swipeFileInputSchema>;

export function loadSwipeFile(): SwipeFileEntry[] {
  const parsed = z
    .array(swipeFileEntrySchema)
    .safeParse(readJsonFile<unknown>(FILE, [] as unknown[]));
  return parsed.success ? parsed.data : [];
}

export class SwipeFileRejected extends Error {}

export function addSwipeFileEntry(input: SwipeFileInput, now: Date = new Date()): SwipeFileEntry {
  if (input.copiedText) {
    throw new SwipeFileRejected(
      'Swipe-file entries record patterns, not copied posts. Describe the structure in your own words.',
    );
  }
  const entry: SwipeFileEntry = {
    id: randomUUID(),
    sourceUrl: input.sourceUrl,
    creator: input.creator,
    capturedAt: now.toISOString(),
    format: input.format,
    hookPattern: input.hookPattern,
    structure: input.structure,
    whyItWorks: input.whyItWorks,
    audience: input.audience,
    adaptationIdea: input.adaptationIdea,
    copiedText: false,
  };
  writeJsonFile(FILE, [...loadSwipeFile(), entry]);
  return entry;
}
