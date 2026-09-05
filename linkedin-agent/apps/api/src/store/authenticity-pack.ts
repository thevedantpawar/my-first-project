import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { POST_TYPES } from '../agents/linkedin-content-agent/strategy.js';
import { readJsonFile, writeJsonFile } from './json-store.js';

const FILE = 'authenticity-pack.json';

export const authenticityIdeaSchema = z.object({
  id: z.string().min(1),
  capturedAt: z.string().min(1),
  /** The founder's own words, stored unedited so the voice survives. */
  rawText: z.string().min(1),
  sourceKind: z.enum([
    'voice_memo',
    'client_call',
    'decision',
    'mistake',
    'obsession',
    'repeated_idea',
    'disagreement',
    'system_built',
    'operating_principle',
    'other',
  ]),
  tags: z.object({
    audience: z.string().default(''),
    painSignal: z.string().default(''),
    dreamSignal: z.string().default(''),
    pointOfView: z.string().default(''),
    contentFormat: z.enum(POST_TYPES).nullable().default(null),
  }),
  used: z.boolean().default(false),
});

export type AuthenticityIdea = z.infer<typeof authenticityIdeaSchema>;

export const authenticityPackSchema = z.object({
  month: z.string().default(''),
  updatedAt: z.string().default(''),
  ideas: z.array(authenticityIdeaSchema).default([]),
});

export type AuthenticityPack = z.infer<typeof authenticityPackSchema>;

/** Input accepted by POST /api/linkedin/authenticity-pack. */
export const authenticityPackInputSchema = z.object({
  month: z.string().optional(),
  /** Raw pasted text; split into ideas on blank lines when `ideas` is absent. */
  rawNotes: z.string().optional(),
  ideas: z
    .array(
      z.object({
        rawText: z.string().min(3),
        sourceKind: authenticityIdeaSchema.shape.sourceKind.optional(),
        tags: authenticityIdeaSchema.shape.tags.partial().optional(),
      }),
    )
    .optional(),
  replace: z.boolean().default(false),
});

export type AuthenticityPackInput = z.infer<typeof authenticityPackInputSchema>;

const EMPTY: AuthenticityPack = { month: '', updatedAt: '', ideas: [] };

export function loadAuthenticityPack(): AuthenticityPack {
  const parsed = authenticityPackSchema.safeParse(readJsonFile<unknown>(FILE, EMPTY));
  return parsed.success ? parsed.data : EMPTY;
}

/**
 * Extracts raw ideas without polishing them. The original wording is kept in
 * `rawText`; tagging is metadata around it, never a rewrite of it.
 */
export function ingestAuthenticityPack(
  input: AuthenticityPackInput,
  now: Date = new Date(),
): AuthenticityPack {
  const existing = input.replace ? [] : loadAuthenticityPack().ideas;

  type RawIdea = {
    rawText: string;
    sourceKind?: AuthenticityIdea['sourceKind'];
    tags?: Partial<AuthenticityIdea['tags']>;
  };

  const fromNotes: RawIdea[] = (input.rawNotes ?? '')
    .split(/\n\s*\n/)
    .map((chunk) => chunk.trim())
    .filter((chunk) => chunk.length >= 3)
    .map((chunk) => ({ rawText: chunk }));

  const incoming: RawIdea[] = [...((input.ideas ?? []) as RawIdea[]), ...fromNotes];

  const added: AuthenticityIdea[] = incoming.map((idea) => ({
    id: randomUUID(),
    capturedAt: now.toISOString(),
    rawText: idea.rawText,
    sourceKind: idea.sourceKind ?? 'other',
    tags: {
      audience: idea.tags?.audience ?? '',
      painSignal: idea.tags?.painSignal ?? '',
      dreamSignal: idea.tags?.dreamSignal ?? '',
      pointOfView: idea.tags?.pointOfView ?? '',
      contentFormat: idea.tags?.contentFormat ?? null,
    },
    used: false,
  }));

  const pack: AuthenticityPack = {
    month: input.month ?? `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`,
    updatedAt: now.toISOString(),
    ideas: [...existing, ...added],
  };
  writeJsonFile(FILE, pack);
  return pack;
}

/** Unused ideas first, so a story format does not reuse the same memory. */
export function suggestAuthenticityIdeas(limit = 5): AuthenticityIdea[] {
  const ideas = loadAuthenticityPack().ideas;
  return [...ideas].sort((a, b) => Number(a.used) - Number(b.used)).slice(0, limit);
}

export function markAuthenticityIdeaUsed(id: string): void {
  const pack = loadAuthenticityPack();
  const next: AuthenticityPack = {
    ...pack,
    ideas: pack.ideas.map((idea) => (idea.id === id ? { ...idea, used: true } : idea)),
  };
  writeJsonFile(FILE, next);
}
