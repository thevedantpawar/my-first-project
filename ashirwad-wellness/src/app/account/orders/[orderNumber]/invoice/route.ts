import { NextResponse } from "next/server";

import { auth } from "@/auth";
import { db } from "@/lib/db";
import { renderInvoicePdf } from "@/lib/invoice";

/**
 * Invoice download.
 *
 * Scoped to the signed-in customer by the query itself — an order number is
 * guessable and must never be enough on its own to read someone else's invoice.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ orderNumber: string }> },
) {
  const session = await auth();
  if (!session?.user?.id) {
    return new NextResponse("Not found", { status: 404 });
  }

  const { orderNumber } = await params;

  const order = await db.order.findFirst({
    where: { orderNumber, userId: session.user.id },
    include: {
      items: true,
      user: { select: { name: true, email: true } },
    },
  });

  if (!order) return new NextResponse("Not found", { status: 404 });

  const pdf = await renderInvoicePdf({
    orderNumber: order.orderNumber,
    placedAt: order.placedAt,
    paymentMethod: order.paymentMethod,
    paymentStatus: order.paymentStatus,
    subtotalPaise: order.subtotalPaise,
    discountPaise: order.discountPaise,
    deliveryPaise: order.deliveryPaise,
    gstPaise: order.gstPaise,
    totalPaise: order.totalPaise,
    couponCode: order.couponCode,
    shipAddressSnapshot: order.shipAddressSnapshot as Record<string, string | null>,
    customerName: order.user.name,
    customerEmail: order.user.email,
    items: order.items.map((i) => ({
      nameSnapshot: i.nameSnapshot,
      compositionSnapshot: i.compositionSnapshot,
      packSizeSnapshot: i.packSizeSnapshot,
      hsnCodeSnapshot: i.hsnCodeSnapshot,
      gstRateBpsSnapshot: i.gstRateBpsSnapshot,
      scheduleTypeSnapshot: i.scheduleTypeSnapshot,
      quantity: i.quantity,
      sellingPricePaise: i.sellingPricePaise,
      lineTotalPaise: i.lineTotalPaise,
      batchNumber: i.batchNumber,
      expiryDate: i.expiryDate,
    })),
  });

  return new NextResponse(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${order.orderNumber}.pdf"`,
      "Cache-Control": "private, no-store",
    },
  });
}
