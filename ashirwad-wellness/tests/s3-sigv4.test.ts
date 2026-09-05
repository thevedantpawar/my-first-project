import { describe, it, expect } from "vitest";

import { signRequest, uriEncode, amzDateNow } from "@/lib/s3";

/**
 * SigV4, checked against Amazon's own published values.
 *
 * The signing algorithm is the part of the S3 driver that cannot be verified by
 * "it seemed to work" — a wrong signature fails identically to wrong
 * credentials, a wrong region, or a wrong clock. So it is pinned to the
 * documented test vectors instead.
 *
 * Credentials below are Amazon's public example values from the SigV4
 * documentation. They are not secrets and grant nothing.
 */

const EXAMPLE_ACCESS_KEY = "AKIDEXAMPLE";
const EXAMPLE_SECRET = "wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY";

describe("SigV4 signing", () => {
  // From the AWS "Signature Version 4 test suite" (get-vanilla): a bare GET
  // against example.amazonaws.com in us-east-1/service.
  it("reproduces the documented signature for get-vanilla", () => {
    const auth = signRequest({
      method: "GET",
      path: "/",
      headers: {
        Host: "example.amazonaws.com",
        "X-Amz-Date": "20150830T123600Z",
      },
      payloadHash: sha256OfEmpty,
      region: "us-east-1",
      service: "service",
      accessKeyId: EXAMPLE_ACCESS_KEY,
      secretAccessKey: EXAMPLE_SECRET,
      amzDate: "20150830T123600Z",
    });

    expect(auth).toBe(
      "AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE/20150830/us-east-1/service/aws4_request, " +
        "SignedHeaders=host;x-amz-date, " +
        "Signature=5fa00fa31553b73ebf1942676e86291e8372ff2a2260956d9b8aae1d763fbf31",
    );
  });

  // get-header-value-trim. Asserted as a property rather than against a
  // hard-coded digest: the only trustworthy source for a specific signature is
  // Amazon's published vector, and inventing one would make this test agree
  // with whatever the implementation happens to do. Equality between the padded
  // and unpadded forms is the actual requirement, and it verifies itself.
  it("trims header values before signing, per the spec", () => {
    const sign = (headerValue: string) =>
      signRequest({
        method: "POST",
        path: "/",
        headers: {
          Host: "example.amazonaws.com",
          "My-Header1": headerValue,
          "X-Amz-Date": "20150830T123600Z",
        },
        payloadHash: sha256OfEmpty,
        region: "us-east-1",
        service: "service",
        accessKeyId: EXAMPLE_ACCESS_KEY,
        secretAccessKey: EXAMPLE_SECRET,
        amzDate: "20150830T123600Z",
      });

    expect(sign("  value1  ")).toBe(sign("value1"));
    // And a genuinely different value must not collide.
    expect(sign("value1")).not.toBe(sign("value2"));
    expect(sign("value1")).toContain("SignedHeaders=host;my-header1;x-amz-date");
  });

  it("lowercases and sorts header names regardless of input order", () => {
    const base = {
      payloadHash: sha256OfEmpty,
      region: "us-east-1",
      service: "service",
      accessKeyId: EXAMPLE_ACCESS_KEY,
      secretAccessKey: EXAMPLE_SECRET,
      amzDate: "20150830T123600Z",
      method: "GET",
      path: "/",
    } as const;

    const a = signRequest({
      ...base,
      headers: { Host: "e.com", "X-Amz-Date": "20150830T123600Z", "A-Header": "1" },
    });
    const b = signRequest({
      ...base,
      headers: { "a-header": "1", "x-amz-date": "20150830T123600Z", HOST: "e.com" },
    });

    expect(a).toBe(b);
    expect(a).toContain("SignedHeaders=a-header;host;x-amz-date");
  });

  it("excludes authorization and content-length from the signed headers", () => {
    const auth = signRequest({
      method: "PUT",
      path: "/bucket/key.png",
      headers: {
        Host: "s3.ap-south-1.amazonaws.com",
        "Content-Length": "1234",
        "Content-Type": "image/png",
        Authorization: "should-be-ignored",
        "X-Amz-Date": "20240101T000000Z",
      },
      payloadHash: sha256OfEmpty,
      region: "ap-south-1",
      service: "s3",
      accessKeyId: EXAMPLE_ACCESS_KEY,
      secretAccessKey: EXAMPLE_SECRET,
      amzDate: "20240101T000000Z",
    });

    expect(auth).toContain("SignedHeaders=content-type;host;x-amz-date");
    expect(auth).not.toContain("content-length");
    expect(auth).not.toContain("authorization;");
  });
});

describe("uriEncode", () => {
  // encodeURIComponent leaves these alone and S3 does not. This is the most
  // common cause of SignatureDoesNotMatch on keys with punctuation.
  it("encodes the characters encodeURIComponent leaves alone", () => {
    expect(uriEncode("a!b'c(d)e*f")).toBe("a%21b%27c%28d%29e%2Af");
  });

  it("leaves unreserved characters untouched", () => {
    expect(uriEncode("Abc-123_x.y~z")).toBe("Abc-123_x.y~z");
  });

  it("encodes slashes in keys but can preserve them in paths", () => {
    expect(uriEncode("prescriptions/a.png")).toBe("prescriptions%2Fa.png");
    expect(uriEncode("/prescriptions/a.png", false)).toBe("/prescriptions/a.png");
  });

  it("encodes multi-byte characters per byte", () => {
    // A Devanagari filename is not hypothetical for this catalogue.
    expect(uriEncode("औ")).toBe("%E0%A4%94");
  });
});

describe("amzDateNow", () => {
  it("formats as ISO8601 basic, which is what SigV4 requires", () => {
    expect(amzDateNow(new Date("2026-08-04T09:07:05.123Z"))).toBe("20260804T090705Z");
  });
});

const sha256OfEmpty =
  "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
