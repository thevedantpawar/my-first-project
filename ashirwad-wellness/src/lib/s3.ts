import "server-only";
import { createHash, createHmac } from "node:crypto";

/**
 * AWS Signature Version 4, by hand.
 *
 * The same reasoning as `razorpay.ts`: this needs three S3 operations (PUT,
 * GET, DELETE) and one signing algorithm. `@aws-sdk/client-s3` pulls in tens of
 * megabytes and a middleware stack to provide them, and hides the one part that
 * actually matters — what exactly gets signed — behind several layers.
 *
 * SigV4 is a fully specified algorithm and is verified here against Amazon's
 * own published test vectors in `tests/s3-sigv4.test.ts`. If those pass, the
 * signing is right; the rest of this file is an HTTP request.
 *
 * Works against any S3-compatible endpoint — AWS S3, Cloudflare R2,
 * DigitalOcean Spaces, MinIO, Backblaze B2 — because the signing is the same
 * and the endpoint is configurable.
 */

const UNSIGNED_HEADERS = new Set(["authorization", "content-length", "user-agent"]);

function sha256Hex(data: string | Buffer): string {
  return createHash("sha256").update(data).digest("hex");
}

function hmac(key: string | Buffer, data: string): Buffer {
  return createHmac("sha256", key).update(data, "utf8").digest();
}

/**
 * RFC 3986 encoding.
 *
 * `encodeURIComponent` leaves !'()* alone, and S3 rejects a signature computed
 * over a differently-encoded path. This is the single most common cause of a
 * SignatureDoesNotMatch on an object key with punctuation in it.
 */
export function uriEncode(value: string, encodeSlash = true): string {
  let out = "";
  for (const char of Buffer.from(value, "utf8")) {
    const c = String.fromCharCode(char);
    if (/[A-Za-z0-9\-._~]/.test(c)) {
      out += c;
    } else if (c === "/") {
      out += encodeSlash ? "%2F" : "/";
    } else {
      out += `%${char.toString(16).toUpperCase().padStart(2, "0")}`;
    }
  }
  return out;
}

export type SigV4Input = {
  method: string;
  /** Already-encoded canonical path, beginning with "/". */
  path: string;
  query?: Record<string, string>;
  headers: Record<string, string>;
  /** Hex sha256 of the body; "UNSIGNED-PAYLOAD" is not used here. */
  payloadHash: string;
  region: string;
  service: string;
  accessKeyId: string;
  secretAccessKey: string;
  /** ISO8601 basic format, e.g. 20130524T000000Z. */
  amzDate: string;
};

/**
 * Returns the Authorization header value for a request.
 *
 * Exported so the test can drive it with Amazon's vectors directly rather than
 * inferring correctness from a live call.
 */
export function signRequest(input: SigV4Input): string {
  const {
    method,
    path,
    query = {},
    headers,
    payloadHash,
    region,
    service,
    accessKeyId,
    secretAccessKey,
    amzDate,
  } = input;

  const dateStamp = amzDate.slice(0, 8);

  const canonicalQuery = Object.keys(query)
    .sort()
    .map((k) => `${uriEncode(k)}=${uriEncode(query[k])}`)
    .join("&");

  // Header names lowercased, values trimmed, sorted by name. Duplicate spaces
  // inside a value are collapsed by the spec; our values never contain any.
  const signable = Object.entries(headers)
    .map(([k, v]) => [k.toLowerCase(), v.trim()] as const)
    .filter(([k]) => !UNSIGNED_HEADERS.has(k))
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));

  const canonicalHeaders = signable.map(([k, v]) => `${k}:${v}\n`).join("");
  const signedHeaders = signable.map(([k]) => k).join(";");

  const canonicalRequest = [
    method,
    path,
    canonicalQuery,
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join("\n");

  const scope = `${dateStamp}/${region}/${service}/aws4_request`;
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    scope,
    sha256Hex(canonicalRequest),
  ].join("\n");

  const signingKey = hmac(
    hmac(hmac(hmac(`AWS4${secretAccessKey}`, dateStamp), region), service),
    "aws4_request",
  );
  const signature = createHmac("sha256", signingKey)
    .update(stringToSign, "utf8")
    .digest("hex");

  return (
    `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${scope}, ` +
    `SignedHeaders=${signedHeaders}, Signature=${signature}`
  );
}

export function amzDateNow(now = new Date()): string {
  return `${now.toISOString().replace(/[-:]/g, "").slice(0, 15)}Z`;
}
