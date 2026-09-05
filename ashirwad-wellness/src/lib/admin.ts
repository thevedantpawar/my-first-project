import "server-only";
import { db } from "./db";
import { OrderStatus, PrescriptionStatus } from "@/generated/prisma/enums";

/** Orders that represent real revenue — not cancelled, rejected or unpaid. */
const REVENUE_STATUSES: OrderStatus[] = [
  OrderStatus.CONFIRMED,
  OrderStatus.PACKED,
  OrderStatus.SHIPPED,
  OrderStatus.OUT_FOR_DELIVERY,
  OrderStatus.DELIVERED,
];

/** A batch inside this window needs attention before it becomes unsellable. */
export const NEAR_EXPIRY_DAYS = 90;

export async function getDashboardMetrics() {
  const now = new Date();
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 3600 * 1000);
  const nearExpiryCutoff = new Date(now.getTime() + NEAR_EXPIRY_DAYS * 24 * 3600 * 1000);

  const [
    revenue,
    revenue30,
    orderCount,
    pendingPrescriptions,
    pendingOrders,
    lowStock,
    nearExpiry,
    expired,
    h1Dispensed,
  ] = await Promise.all([
    db.order.aggregate({
      where: { status: { in: REVENUE_STATUSES } },
      _sum: { totalPaise: true },
      _count: true,
    }),
    db.order.aggregate({
      where: { status: { in: REVENUE_STATUSES }, placedAt: { gte: thirtyDaysAgo } },
      _sum: { totalPaise: true },
      _count: true,
    }),
    db.order.count(),
    db.prescription.count({
      where: {
        status: { in: [PrescriptionStatus.UPLOADED, PrescriptionStatus.UNDER_REVIEW] },
      },
    }),
    db.order.count({ where: { status: OrderStatus.PENDING_PHARMACIST_REVIEW } }),
    db.$queryRaw<{ count: bigint }[]>`
      SELECT COUNT(*) AS count FROM "products"
      WHERE "isActive" = true AND "stock" <= "lowStockAlert"
    `,
    db.inventoryBatch.count({
      where: { expiryDate: { gt: now, lte: nearExpiryCutoff }, quantity: { gt: 0 } },
    }),
    db.inventoryBatch.count({
      where: { expiryDate: { lte: now }, quantity: { gt: 0 } },
    }),
    db.scheduleH1Register.count(),
  ]);

  const totalRevenuePaise = revenue._sum.totalPaise ?? 0;
  const paidOrders = revenue._count;

  return {
    totalRevenuePaise,
    revenue30Paise: revenue30._sum.totalPaise ?? 0,
    orders30: revenue30._count,
    orderCount,
    paidOrders,
    // Average order value, in paise. Zero orders means zero, not NaN.
    aovPaise: paidOrders > 0 ? Math.round(totalRevenuePaise / paidOrders) : 0,
    pendingPrescriptions,
    pendingOrders,
    lowStockCount: Number(lowStock[0]?.count ?? 0),
    nearExpiryCount: nearExpiry,
    expiredCount: expired,
    h1Dispensed,
  };
}

export async function getLowStockProducts(take = 20) {
  return db.$queryRaw<
    {
      id: string;
      name: string;
      slug: string;
      stock: number;
      lowStockAlert: number;
      scheduleType: string;
    }[]
  >`
    SELECT "id", "name", "slug", "stock", "lowStockAlert", "scheduleType"
    FROM "products"
    WHERE "isActive" = true AND "stock" <= "lowStockAlert"
    ORDER BY "stock" ASC
    LIMIT ${take}
  `;
}

export async function getExpiringBatches(take = 50) {
  const cutoff = new Date(Date.now() + NEAR_EXPIRY_DAYS * 24 * 3600 * 1000);

  return db.inventoryBatch.findMany({
    where: { expiryDate: { lte: cutoff }, quantity: { gt: 0 } },
    include: {
      product: { select: { name: true, slug: true, scheduleType: true } },
    },
    orderBy: { expiryDate: "asc" },
    take,
  });
}

export async function getRecentOrders(take = 25) {
  return db.order.findMany({
    take,
    orderBy: { placedAt: "desc" },
    select: {
      id: true,
      orderNumber: true,
      status: true,
      paymentMethod: true,
      paymentStatus: true,
      totalPaise: true,
      placedAt: true,
      containsRxItems: true,
      containsH1Items: true,
      user: { select: { name: true, email: true } },
    },
  });
}

export async function getAuditLog(filters: {
  action?: string;
  entityType?: string;
  take?: number;
  skip?: number;
}) {
  const where = {
    ...(filters.action ? { action: filters.action as never } : {}),
    ...(filters.entityType ? { entityType: filters.entityType } : {}),
  };

  const [entries, total] = await Promise.all([
    db.auditLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: filters.take ?? 100,
      skip: filters.skip ?? 0,
      include: { actor: { select: { name: true, email: true, role: true } } },
    }),
    db.auditLog.count({ where }),
  ]);

  return { entries, total };
}

export async function getProductFormOptions() {
  const [categories, manufacturers, brands] = await Promise.all([
    db.category.findMany({
      where: { parentId: { not: null } },
      select: { id: true, name: true, slug: true },
      orderBy: { name: "asc" },
    }),
    db.manufacturer.findMany({
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    db.brand.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);

  return { categories, manufacturers, brands };
}

export async function getStaff() {
  return db.user.findMany({
    where: { role: { in: ["PHARMACIST", "ADMIN"] } },
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      pharmacistRegNo: true,
      isActive: true,
    },
    orderBy: [{ role: "asc" }, { name: "asc" }],
  });
}
