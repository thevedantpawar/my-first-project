import "server-only";
import { db } from "./db";
import { ScheduleType } from "@/generated/prisma/enums";

/**
 * Application-layer half of the Schedule X / narcotic / psychotropic block.
 *
 * The database trigger (products_banned_substance_guard) is the enforcement
 * point and cannot be bypassed. This layer exists to produce a usable error
 * message before the write is attempted, and to write an audit row — a raw
 * trigger exception tells an admin nothing actionable.
 *
 * Never treat this as the enforcement point. If this file were deleted, the
 * block would still hold.
 */

export class BannedSubstanceError extends Error {
  readonly substance: string;
  readonly reason: string;
  readonly authority: string | null;

  constructor(substance: string, reason: string, authority: string | null) {
    super(
      `Refused to list this product: it contains "${substance}", which is ` +
        `${reason.toLowerCase().replace(/_/g, " ")}. ` +
        `${authority ?? "This substance cannot be sold online."} ` +
        `Ashirwad Wellness does not list controlled substances under any schedule type.`,
    );
    this.name = "BannedSubstanceError";
    this.substance = substance;
    this.reason = reason;
    this.authority = authority;
  }
}

/**
 * Checks product name and composition against the banned list.
 * Case-insensitive substring match, mirroring the trigger's logic exactly —
 * if these two ever disagree, the trigger wins and the admin sees a raw error,
 * which is the correct failure direction.
 */
export async function assertNotBannedSubstance(input: {
  name: string;
  composition: string;
}): Promise<void> {
  const haystack = `${input.name} ${input.composition}`.toLowerCase();

  const banned = await db.bannedSubstance.findMany({
    select: { name: true, reason: true, authority: true },
  });

  const hit = banned.find((b) => haystack.includes(b.name.toLowerCase()));
  if (hit) {
    throw new BannedSubstanceError(hit.name, hit.reason, hit.authority);
  }
}

/**
 * Schedule types this platform is permitted to list. Mirrors the
 * products_permitted_schedule_types CHECK constraint.
 */
const PERMITTED: ReadonlySet<ScheduleType> = new Set([
  ScheduleType.OTC,
  ScheduleType.SCHEDULE_H,
  ScheduleType.SCHEDULE_H1,
  ScheduleType.AYURVEDIC,
  ScheduleType.COSMETIC,
  ScheduleType.NUTRACEUTICAL,
  ScheduleType.DEVICE,
]);

export function assertPermittedScheduleType(scheduleType: ScheduleType): void {
  if (!PERMITTED.has(scheduleType)) {
    throw new Error(
      `Schedule type "${scheduleType}" cannot be listed on this platform. ` +
        `Schedule X drugs, narcotics, psychotropics and habit-forming ` +
        `substances are not dispensable online.`,
    );
  }
}
