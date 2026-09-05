import { writeFileSync } from 'node:fs';
import { z } from 'zod';
import { destinationUrls, getConfig } from '../config.js';
import {
  loadProfileAuditConfig,
  profileAuditPath,
  profileAuditSchema,
} from '../agents/linkedin-content-agent/strategy.js';
import type { ProfileAuditConfig } from '../agents/linkedin-content-agent/strategy.js';

export interface ProfileAuditReport {
  items: ProfileAuditConfig['items'];
  proof: ProfileAuditConfig['proof'];
  completed: number;
  total: number;
  completionPercentage: number;
  warnings: string[];
}

/**
 * Profile conversion checklist plus the destination URLs a CTA can point at.
 * Nothing here is inferred from LinkedIn — an operator ticks each item off by
 * hand, so the dashboard never claims a profile element exists when it does not.
 */
export function buildProfileAudit(): ProfileAuditReport {
  const config = loadProfileAuditConfig();
  const completed = config.items.filter((item) => item.completed).length;
  const warnings = config.items
    .filter((item) => !item.completed)
    .map((item) => `Incomplete: ${item.label}`);

  const urls = destinationUrls(getConfig());
  for (const [key, value] of Object.entries(urls)) {
    if (value.trim() === '') {
      warnings.push(`${key} is not configured; CTAs that point at it are blocked.`);
    }
  }
  if (config.proof.length === 0) {
    warnings.push(
      'No proof recorded. Add real case studies or results manually — the agent never invents them.',
    );
  }

  return {
    items: config.items,
    proof: config.proof,
    completed,
    total: config.items.length,
    completionPercentage:
      config.items.length === 0 ? 0 : Math.round((completed / config.items.length) * 100),
    warnings,
  };
}

export const profileAuditUpdateSchema = z.object({
  items: z
    .array(z.object({ id: z.string().min(1), completed: z.boolean().optional(), notes: z.string().optional() }))
    .optional(),
  proof: z
    .array(
      z.object({
        id: z.string().min(1),
        claim: z.string().min(1),
        evidenceUrl: z.string().default(''),
        recordedAt: z.string().default(''),
      }),
    )
    .optional(),
});

export type ProfileAuditUpdate = z.infer<typeof profileAuditUpdateSchema>;

/** Records real, operator-supplied progress and proof. */
export function updateProfileAudit(
  update: ProfileAuditUpdate,
  now: Date = new Date(),
): ProfileAuditReport {
  const current = loadProfileAuditConfig();
  const items = current.items.map((item) => {
    const patch = update.items?.find((candidate) => candidate.id === item.id);
    if (!patch) return item;
    return {
      ...item,
      completed: patch.completed ?? item.completed,
      notes: patch.notes ?? item.notes,
    };
  });

  const proof = update.proof
    ? [
        ...current.proof,
        ...update.proof.map((entry) => ({
          ...entry,
          recordedAt: entry.recordedAt || now.toISOString(),
        })),
      ]
    : current.proof;

  const next = profileAuditSchema.parse({ items, proof });
  writeFileSync(profileAuditPath(), `${JSON.stringify(next, null, 2)}\n`, 'utf8');
  return buildProfileAudit();
}
