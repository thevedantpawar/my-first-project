import "server-only";
import { formatPaise } from "./money";
import { pharmacy } from "./pharmacy";
import type { PaymentMethod } from "@/generated/prisma/enums";

/**
 * Transactional email via Resend.
 *
 * Sending never throws into the caller: an order that succeeded must not be
 * reported as failed because an email provider was briefly unreachable. A
 * failure is logged loudly instead.
 *
 * With RESEND_API_KEY unset the message is written to the server console, so
 * the flow is testable in development without a provider.
 */

type SendArgs = {
  to: string | null;
  subject: string;
  html: string;
  text: string;
};

async function send({ to, subject, html, text }: SendArgs): Promise<void> {
  if (!to) return;

  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM ?? "Ashirwad Wellness <noreply@example.invalid>";

  if (!apiKey) {
    console.info(
      `[email:stub] To: ${to}\nSubject: ${subject}\n\n${text}\n` +
        "(Set RESEND_API_KEY to send for real.)",
    );
    return;
  }

  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ from, to, subject, html, text }),
    });

    if (!response.ok) {
      console.error(
        `[email] Resend rejected the message (${response.status}): ${await response.text()}`,
      );
    }
  } catch (error) {
    console.error("[email] failed to send", error);
  }
}

const wrapper = (body: string) => `
<div style="font-family:system-ui,-apple-system,'Segoe UI',sans-serif;max-width:560px;margin:0 auto;color:#141A17">
  <div style="background:#0F3D2E;padding:20px 24px">
    <p style="margin:0;color:#F7F5F0;font-size:18px;font-weight:600">Ashirwad Wellness</p>
    <p style="margin:2px 0 0;color:#D9E6E0;font-size:12px">${pharmacy.tradeName} · Nashik, Maharashtra</p>
  </div>
  <div style="padding:24px;background:#F7F5F0">${body}</div>
  <div style="padding:16px 24px;background:#EFECE4;font-size:11px;color:#5B6660;line-height:1.6">
    <p style="margin:0">Drug Licence (20B): ${pharmacy.drugLicence20B}</p>
    <p style="margin:0">Drug Licence (21B): ${pharmacy.drugLicence21B}</p>
    <p style="margin:0">FSSAI: ${pharmacy.fssaiLicence}</p>
    <p style="margin:0">Registered Pharmacist: ${pharmacy.pharmacistName} (${pharmacy.pharmacistRegNo})</p>
    <p style="margin:8px 0 0">This email is for reference and does not replace advice from a qualified medical practitioner.</p>
  </div>
</div>`;

export async function sendOrderConfirmation(args: {
  to: string | null;
  customerName: string | null;
  orderNumber: string;
  totalPaise: number;
  requiresPharmacistReview: boolean;
  paymentMethod: PaymentMethod;
}): Promise<void> {
  const greeting = args.customerName ? `Hello ${args.customerName},` : "Hello,";

  const reviewNote = args.requiresPharmacistReview
    ? "Your order contains prescription medicines. A registered pharmacist will review your prescription before anything is dispensed. We will email you as soon as that review is complete."
    : "We are preparing your order for dispatch.";

  const text = [
    greeting,
    "",
    `We have received your order ${args.orderNumber}.`,
    `Total: ${formatPaise(args.totalPaise)} (${args.paymentMethod === "COD" ? "cash on delivery" : "paid online"})`,
    "",
    reviewNote,
    "",
    `${pharmacy.tradeName}`,
  ].join("\n");

  const html = wrapper(`
    <p style="margin:0 0 12px">${greeting}</p>
    <p style="margin:0 0 16px">We have received your order.</p>
    <table style="width:100%;border-collapse:collapse;font-size:14px">
      <tr>
        <td style="padding:6px 0;color:#5B6660">Order number</td>
        <td style="padding:6px 0;text-align:right;font-family:ui-monospace,monospace;font-weight:600">${args.orderNumber}</td>
      </tr>
      <tr>
        <td style="padding:6px 0;color:#5B6660">Total</td>
        <td style="padding:6px 0;text-align:right;font-family:ui-monospace,monospace;font-weight:600">${formatPaise(args.totalPaise)}</td>
      </tr>
      <tr>
        <td style="padding:6px 0;color:#5B6660">Payment</td>
        <td style="padding:6px 0;text-align:right">${args.paymentMethod === "COD" ? "Cash on delivery" : "Paid online"}</td>
      </tr>
    </table>
    ${
      args.requiresPharmacistReview
        ? `<div style="margin-top:16px;border-left:3px solid #B3261E;background:#FBEFEE;padding:12px">
             <p style="margin:0;font-size:13px;color:#8C1D17"><strong>Prescription review pending.</strong> ${reviewNote}</p>
           </div>`
        : `<p style="margin:16px 0 0;font-size:13px;color:#5B6660">${reviewNote}</p>`
    }
  `);

  await send({
    to: args.to,
    subject: `Order ${args.orderNumber} received — Ashirwad Wellness`,
    html,
    text,
  });
}

export async function sendPrescriptionVerified(args: {
  to: string | null;
  customerName: string | null;
  orderNumber?: string;
}): Promise<void> {
  const greeting = args.customerName ? `Hello ${args.customerName},` : "Hello,";
  const text = `${greeting}\n\nA registered pharmacist has verified your prescription${
    args.orderNumber ? ` and released order ${args.orderNumber} for dispensing` : ""
  }.\n\n${pharmacy.tradeName}`;

  await send({
    to: args.to,
    subject: "Your prescription has been verified — Ashirwad Wellness",
    html: wrapper(`<p style="margin:0 0 12px">${greeting}</p><p style="margin:0">${text.split("\n\n")[1]}</p>`),
    text,
  });
}

export async function sendPrescriptionRejected(args: {
  to: string | null;
  customerName: string | null;
  reason: string;
}): Promise<void> {
  const greeting = args.customerName ? `Hello ${args.customerName},` : "Hello,";
  const text = `${greeting}\n\nA registered pharmacist was unable to verify your prescription.\n\nReason: ${args.reason}\n\nYou can upload a clearer image or a new prescription from your account.\n\n${pharmacy.tradeName}`;

  await send({
    to: args.to,
    subject: "We could not verify your prescription — Ashirwad Wellness",
    html: wrapper(`
      <p style="margin:0 0 12px">${greeting}</p>
      <p style="margin:0 0 12px">A registered pharmacist was unable to verify your prescription.</p>
      <div style="border-left:3px solid #B3261E;background:#FBEFEE;padding:12px">
        <p style="margin:0;font-size:13px;color:#8C1D17"><strong>Reason:</strong> ${args.reason}</p>
      </div>
      <p style="margin:12px 0 0;font-size:13px">You can upload a clearer image or a new prescription from your account.</p>
    `),
    text,
  });
}
