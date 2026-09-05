import "server-only";
import PDFDocument from "pdfkit";

import { pharmacy } from "./pharmacy";
import { formatGstRate } from "./money";
import { ScheduleType } from "@/generated/prisma/enums";

/**
 * Tax invoice.
 *
 * Carries what a retail pharmacy invoice has to carry: both drug licence
 * numbers, the FSSAI licence, the GSTIN, the registered pharmacist's name and
 * registration number, and per-line HSN codes with the GST rate.
 *
 * Amounts are rendered as "Rs." rather than the ₹ glyph: pdfkit's built-in
 * Helvetica has no U+20B9, and a missing glyph on a tax document reads as a
 * broken invoice. Embedding a Devanagari-capable font would be the alternative
 * if the rupee symbol is wanted.
 */

export type InvoiceOrder = {
  orderNumber: string;
  placedAt: Date;
  paymentMethod: string;
  paymentStatus: string;
  subtotalPaise: number;
  discountPaise: number;
  deliveryPaise: number;
  gstPaise: number;
  totalPaise: number;
  couponCode: string | null;
  shipAddressSnapshot: Record<string, string | null>;
  customerName: string | null;
  customerEmail: string | null;
  items: {
    nameSnapshot: string;
    compositionSnapshot: string;
    packSizeSnapshot: string;
    hsnCodeSnapshot: string;
    gstRateBpsSnapshot: number;
    scheduleTypeSnapshot: ScheduleType;
    quantity: number;
    sellingPricePaise: number;
    lineTotalPaise: number;
    batchNumber: string | null;
    expiryDate: Date | null;
  }[];
};

/** "Rs. 1,04,55.50" — Indian grouping, no ₹ glyph. */
function money(paise: number): string {
  const rupees = (paise / 100).toFixed(2);
  const [whole, fraction] = rupees.split(".");
  // Indian digit grouping: last three, then pairs.
  const lastThree = whole.slice(-3);
  const rest = whole.slice(0, -3);
  const grouped = rest
    ? `${rest.replace(/\B(?=(\d{2})+(?!\d))/g, ",")},${lastThree}`
    : lastThree;
  return `Rs. ${grouped}.${fraction}`;
}

const RX_SCHEDULES = new Set<ScheduleType>([
  ScheduleType.SCHEDULE_H,
  ScheduleType.SCHEDULE_H1,
]);

export function renderInvoicePdf(order: InvoiceOrder): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 40 });
    const chunks: Buffer[] = [];

    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const PINE = "#0F3D2E";
    const INK = "#141A17";
    const MUTED = "#5B6660";
    const RX = "#B3261E";
    const left = 40;
    const right = 555;

    // --- Header -----------------------------------------------------------
    doc.rect(0, 0, 595, 92).fill(PINE);
    doc.fillColor("#F7F5F0").fontSize(18).font("Helvetica-Bold");
    doc.text(pharmacy.tradeName, left, 26);
    doc.fontSize(8).font("Helvetica").fillColor("#D9E6E0");
    doc.text(pharmacy.address, left, 50, { width: 320 });

    doc.fontSize(14).font("Helvetica-Bold").fillColor("#F7F5F0");
    doc.text("TAX INVOICE", right - 160, 26, { width: 160, align: "right" });
    doc.fontSize(9).font("Courier").fillColor("#D9E6E0");
    doc.text(order.orderNumber, right - 160, 46, { width: 160, align: "right" });
    doc.text(order.placedAt.toLocaleDateString("en-IN"), right - 160, 60, {
      width: 160,
      align: "right",
    });

    // --- Statutory identifiers -------------------------------------------
    let y = 106;
    doc.fillColor(MUTED).fontSize(7.5).font("Helvetica");
    const identifiers: [string, string][] = [
      ["Drug Licence (Form 20B)", pharmacy.drugLicence20B],
      ["Drug Licence (Form 21B)", pharmacy.drugLicence21B],
      ["FSSAI Licence", pharmacy.fssaiLicence],
      ["GSTIN", pharmacy.gstin],
      ["Registered Pharmacist", pharmacy.pharmacistName],
      [`Reg. No. (${pharmacy.pharmacistCouncil})`, pharmacy.pharmacistRegNo],
    ];

    identifiers.forEach(([label, value], i) => {
      const col = i % 3;
      const row = Math.floor(i / 3);
      const x = left + col * 172;
      const ry = y + row * 24;
      doc.fillColor(MUTED).font("Helvetica").fontSize(6.5).text(label.toUpperCase(), x, ry);
      const unset = value.startsWith("REPLACE_ME");
      doc
        .fillColor(unset ? RX : INK)
        .font("Courier")
        .fontSize(8)
        .text(unset ? "NOT CONFIGURED" : value, x, ry + 8, { width: 168 });
    });

    y += 56;
    doc.moveTo(left, y).lineTo(right, y).strokeColor("#D5D9D5").stroke();
    y += 12;

    // --- Bill to ----------------------------------------------------------
    const a = order.shipAddressSnapshot;
    doc.fillColor(MUTED).fontSize(6.5).font("Helvetica").text("BILL TO", left, y);
    doc.fillColor(INK).fontSize(9).font("Helvetica-Bold");
    doc.text(a.fullName ?? order.customerName ?? "Customer", left, y + 10);
    doc.font("Helvetica").fontSize(8).fillColor(MUTED);
    doc.text(
      [a.line1, a.line2, a.landmark].filter(Boolean).join(", "),
      left,
      y + 23,
      { width: 240 },
    );
    doc.text(
      `${a.city ?? ""}, ${a.state ?? ""} ${a.pincode ?? ""}`,
      left,
      doc.y,
      { width: 240 },
    );
    if (a.phone) doc.font("Courier").text(a.phone, left, doc.y);

    doc.fillColor(MUTED).fontSize(6.5).font("Helvetica").text("PAYMENT", 340, y);
    doc.fillColor(INK).fontSize(9).font("Helvetica");
    doc.text(
      order.paymentMethod === "COD" ? "Cash on delivery" : "Paid online",
      340,
      y + 10,
    );
    doc.fontSize(8).fillColor(MUTED).text(`Status: ${order.paymentStatus}`, 340, y + 24);

    y = Math.max(doc.y, y + 60) + 12;

    // --- Line items -------------------------------------------------------
    const cols = { item: left, hsn: 300, gst: 350, qty: 392, rate: 425, amount: 490 };

    doc.rect(left, y, right - left, 18).fill(PINE);
    doc.fillColor("#F7F5F0").fontSize(7.5).font("Helvetica-Bold");
    doc.text("ITEM", cols.item + 4, y + 5);
    doc.text("HSN", cols.hsn, y + 5);
    doc.text("GST", cols.gst, y + 5);
    doc.text("QTY", cols.qty, y + 5);
    doc.text("RATE", cols.rate, y + 5, { width: 55, align: "right" });
    doc.text("AMOUNT", cols.amount, y + 5, { width: 61, align: "right" });
    y += 22;

    for (const item of order.items) {
      const isRx = RX_SCHEDULES.has(item.scheduleTypeSnapshot);

      doc.fillColor(INK).fontSize(8.5).font("Helvetica-Bold");
      doc.text(item.nameSnapshot, cols.item + 4, y, { width: 250 });

      let lineY = doc.y;
      doc.fillColor(MUTED).fontSize(7).font("Helvetica");
      doc.text(`${item.compositionSnapshot} · ${item.packSizeSnapshot}`, cols.item + 4, lineY, { width: 250 });
      lineY = doc.y;

      if (item.batchNumber) {
        doc.font("Courier").fontSize(6.5);
        doc.text(
          `Batch ${item.batchNumber}` +
            (item.expiryDate ? `  Exp ${item.expiryDate.toLocaleDateString("en-IN")}` : ""),
          cols.item + 4,
          lineY,
          { width: 250 },
        );
        lineY = doc.y;
      }

      if (isRx) {
        doc.fillColor(RX).font("Helvetica-Bold").fontSize(6.5);
        doc.text(
          item.scheduleTypeSnapshot === ScheduleType.SCHEDULE_H1
            ? "Rx  SCHEDULE H1 - dispensed against a verified prescription; recorded in the statutory register"
            : "Rx  SCHEDULE H - dispensed against a verified prescription",
          cols.item + 4,
          lineY,
          { width: 250 },
        );
        lineY = doc.y;
      }

      doc.fillColor(INK).font("Courier").fontSize(8);
      doc.text(item.hsnCodeSnapshot, cols.hsn, y);
      doc.text(formatGstRate(item.gstRateBpsSnapshot), cols.gst, y);
      doc.text(String(item.quantity), cols.qty, y);
      doc.text(money(item.sellingPricePaise), cols.rate, y, { width: 55, align: "right" });
      doc.text(money(item.lineTotalPaise), cols.amount, y, { width: 61, align: "right" });

      y = Math.max(lineY, y + 12) + 6;
      doc.moveTo(left, y - 3).lineTo(right, y - 3).strokeColor("#EFECE4").stroke();

      if (y > 690) {
        doc.addPage();
        y = 50;
      }
    }

    // --- Totals -----------------------------------------------------------
    y += 6;
    const totals: [string, string][] = [
      ["Subtotal", money(order.subtotalPaise)],
      ...(order.discountPaise > 0
        ? ([[`Discount${order.couponCode ? ` (${order.couponCode})` : ""}`, `-${money(order.discountPaise)}`]] as [string, string][])
        : []),
      ["Delivery", order.deliveryPaise === 0 ? "Free" : money(order.deliveryPaise)],
      ["GST (included in the above)", money(order.gstPaise)],
    ];

    for (const [label, value] of totals) {
      doc.fillColor(MUTED).fontSize(8).font("Helvetica").text(label, 340, y, { width: 130, align: "right" });
      doc.fillColor(INK).font("Courier").text(value, cols.amount, y, { width: 61, align: "right" });
      y += 14;
    }

    doc.rect(340, y, right - 340, 22).fill(PINE);
    doc.fillColor("#F7F5F0").fontSize(9).font("Helvetica-Bold");
    doc.text("TOTAL", 348, y + 6);
    doc.font("Courier").text(money(order.totalPaise), cols.amount, y + 6, { width: 61, align: "right" });
    y += 34;

    // --- Footer -----------------------------------------------------------
    doc.fillColor(MUTED).fontSize(6.5).font("Helvetica");
    doc.text(
      "All prices are inclusive of GST. Prescription medicines listed above were dispensed only after a registered " +
        "pharmacist verified the corresponding prescription. Medicines cannot be returned once dispensed, in the " +
        "interest of the safety of other patients. This is a computer-generated invoice.",
      left,
      y,
      { width: right - left },
    );

    doc.end();
  });
}
