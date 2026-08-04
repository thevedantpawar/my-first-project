import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { createHash } from "node:crypto";
import http from "node:http";
import type { AddressInfo } from "node:net";

/**
 * The S3 driver, over real HTTP.
 *
 * `s3-sigv4.test.ts` proves the signing maths against Amazon's published
 * vectors. This proves the other half: that the driver forms the right
 * requests, round-trips bytes intact, distinguishes "absent" from "failed", and
 * actually sends the privacy headers it claims to.
 *
 * The server below is a minimal S3-compatible stand-in rather than a mock of
 * our own client — the driver makes genuine network calls into it and has no
 * idea it is not AWS.
 */

type Recorded = {
  method: string;
  url: string;
  headers: http.IncomingHttpHeaders;
  body: Buffer;
};

const objects = new Map<string, { body: Buffer; contentType: string }>();
const requests: Recorded[] = [];
let server: http.Server;
let baseUrl: string;

/** Set by a test to make the next request fail, so error paths are exercised. */
let failNextWith: number | null = null;

beforeAll(async () => {
  server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const body = Buffer.concat(chunks);
      requests.push({
        method: req.method!,
        url: req.url!,
        headers: req.headers,
        body,
      });

      if (failNextWith !== null) {
        const status = failNextWith;
        failNextWith = null;
        res.writeHead(status).end("<Error><Code>AccessDenied</Code></Error>");
        return;
      }

      // Every authenticated S3 request must carry these three. If the driver
      // ever stops sending one, the real service answers 403 and this catches
      // it first.
      const auth = req.headers.authorization ?? "";
      if (!auth.startsWith("AWS4-HMAC-SHA256 Credential=")) {
        res.writeHead(403).end("<Error><Code>MissingAuth</Code></Error>");
        return;
      }
      if (!req.headers["x-amz-date"]) {
        res.writeHead(403).end("<Error><Code>MissingDate</Code></Error>");
        return;
      }
      // The content hash must actually describe the body that arrived.
      const declared = req.headers["x-amz-content-sha256"];
      const actual = createHash("sha256").update(body).digest("hex");
      if (declared !== actual) {
        res.writeHead(400).end("<Error><Code>BadDigest</Code></Error>");
        return;
      }

      // /bucket/key...
      const key = decodeURIComponent(req.url!.split("/").slice(2).join("/"));

      if (req.method === "PUT") {
        objects.set(key, {
          body,
          contentType: String(req.headers["content-type"] ?? "application/octet-stream"),
        });
        res.writeHead(200).end();
      } else if (req.method === "GET") {
        const found = objects.get(key);
        if (!found) {
          res.writeHead(404).end("<Error><Code>NoSuchKey</Code></Error>");
          return;
        }
        res.writeHead(200, { "content-type": found.contentType }).end(found.body);
      } else if (req.method === "DELETE") {
        objects.delete(key);
        res.writeHead(204).end();
      } else {
        res.writeHead(405).end();
      }
    });
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

/** Fresh module instance bound to the stand-in server. */
async function loadStorage(overrides: Record<string, string | undefined> = {}) {
  vi.resetModules();
  const env = process.env as Record<string, string | undefined>;
  env.S3_ENDPOINT = baseUrl;
  env.S3_BUCKET_PRESCRIPTIONS = "ashirwad-private";
  env.S3_REGION = "ap-south-1";
  env.S3_ACCESS_KEY_ID = "TESTKEYID";
  env.S3_SECRET_ACCESS_KEY = "TESTSECRET";
  // Assigning undefined to process.env stores the *string* "undefined", which
  // is truthy — so an "unset this" override has to be a delete.
  for (const [k, v] of Object.entries(overrides)) {
    if (v === undefined) delete env[k];
    else env[k] = v;
  }

  const mod = await import("@/lib/storage");
  return mod;
}

describe("S3 private storage", () => {
  it("selects the S3 driver when a bucket is configured", async () => {
    const { getStorage } = await loadStorage();
    expect(getStorage().name).toBe("s3");
  });

  it("round-trips an object with its content type intact", async () => {
    const { getStorage } = await loadStorage();
    const storage = getStorage();

    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
    await storage.put("prescriptions/abc-123.png", png, "image/png");

    const got = await storage.get("prescriptions/abc-123.png");
    expect(got).not.toBeNull();
    expect(got!.body.equals(png)).toBe(true);
    expect(got!.contentType).toBe("image/png");
  });

  it("returns null for a missing object rather than throwing", async () => {
    const { getStorage } = await loadStorage();
    // "Absent" and "broken" must not look the same to the caller: a missing
    // prescription shows the pharmacist a refusal, an error is a 500.
    expect(await getStorage().get("prescriptions/never-written.png")).toBeNull();
  });

  it("deletes, and a delete of an absent object is not an error", async () => {
    const { getStorage } = await loadStorage();
    const storage = getStorage();

    await storage.put("health-records/x.pdf", Buffer.from("pdf"), "application/pdf");
    await storage.delete("health-records/x.pdf");
    expect(await storage.get("health-records/x.pdf")).toBeNull();

    await expect(storage.delete("health-records/x.pdf")).resolves.toBeUndefined();
  });

  it("sends private ACL and server-side encryption on write", async () => {
    const { getStorage } = await loadStorage();
    requests.length = 0;
    await getStorage().put("prescriptions/acl.png", Buffer.from("x"), "image/png");

    const put = requests.find((r) => r.method === "PUT")!;
    expect(put.headers["x-amz-acl"]).toBe("private");
    expect(put.headers["x-amz-server-side-encryption"]).toBe("AES256");
  });

  it("surfaces a write failure instead of silently losing the upload", async () => {
    const { getStorage } = await loadStorage();
    failNextWith = 403;
    await expect(
      getStorage().put("prescriptions/denied.png", Buffer.from("x"), "image/png"),
    ).rejects.toThrow(/S3 PUT failed \(403\)/);
  });

  it("surfaces a read failure that is not a 404", async () => {
    const { getStorage } = await loadStorage();
    failNextWith = 500;
    await expect(getStorage().get("prescriptions/boom.png")).rejects.toThrow(
      /S3 GET failed \(500\)/,
    );
  });

  it("handles keys and buckets needing RFC-3986 encoding", async () => {
    const { getStorage } = await loadStorage();
    const storage = getStorage();
    // encodeURIComponent would leave the parentheses alone and the signature
    // would not match on a real endpoint.
    const key = "prescriptions/scan (1)'s copy.png";
    await storage.put(key, Buffer.from("paren"), "image/png");
    expect((await storage.get(key))!.body.toString()).toBe("paren");
  });

  it("refuses a half-configured bucket rather than failing at first upload", async () => {
    const { getStorage } = await loadStorage({ S3_ACCESS_KEY_ID: undefined });
    expect(() => getStorage()).toThrow(/S3_ACCESS_KEY_ID/);
  });
});
