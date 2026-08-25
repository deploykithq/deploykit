import { generateKeyPairSync } from "crypto";
import { describe, it, expect } from "vitest";
import ssh2 from "ssh2";

// Same CJS caveat as ssh-keygen.ts: `utils` is not a detectable named export.
const sshUtils = ssh2.utils;

import {
  generateKeyPair,
  parsePrivateKey,
  SshKeyParseError,
} from "./ssh-keygen";

/** ssh2's own parser is the oracle: if it can't read the key, no deploy can. */
const parseWithSsh2 = (privateKey: string) => {
  const parsed = sshUtils.parseKey(privateKey);
  if (parsed instanceof Error) throw parsed;
  return Array.isArray(parsed) ? parsed[0]! : parsed;
};

describe.each([
  { type: "ed25519" as const, sshType: "ssh-ed25519" },
  { type: "rsa" as const, sshType: "ssh-rsa" },
])("generateKeyPair($type)", ({ type, sshType }) => {
  it("produces a key ssh2 can parse, with a matching public half", () => {
    const key = generateKeyPair(type, "deploykit");

    expect(key.type).toBe(type);
    expect(key.privateKey.startsWith("-----BEGIN OPENSSH PRIVATE KEY-----")).toBe(
      true,
    );
    expect(
      key.privateKey.trimEnd().endsWith("-----END OPENSSH PRIVATE KEY-----"),
    ).toBe(true);

    const parsed = parseWithSsh2(key.privateKey);
    expect(parsed.type).toBe(sshType);

    // getPublicSSH() returns the wire-format blob; ours is base64 of the same bytes.
    const ourBlob = Buffer.from(key.publicKey.split(" ")[1]!, "base64");
    expect(Buffer.compare(parsed.getPublicSSH(), ourBlob)).toBe(0);
  });

  it("round-trips through parsePrivateKey", () => {
    const key = generateKeyPair(type, "deploykit");
    const parsed = parsePrivateKey(key.privateKey);

    expect(parsed.type).toBe(type);
    expect(parsed.fingerprint).toBe(key.fingerprint);
    // The comment is not part of the wire blob, so compare the base64 body only.
    expect(parsed.publicKey.split(" ")[1]).toBe(key.publicKey.split(" ")[1]);
  });
});

describe("generateKeyPair output shape", () => {
  it("emits a one-line authorized_keys entry carrying the comment", () => {
    const key = generateKeyPair("ed25519", "admin@deploykit");
    expect(key.publicKey).toMatch(
      /^ssh-ed25519 [A-Za-z0-9+/=]+ admin@deploykit$/,
    );
    expect(key.publicKey).not.toContain("\n");
  });

  it("emits a SHA256 fingerprint with no base64 padding", () => {
    const key = generateKeyPair("ed25519", "deploykit");
    // 32 raw bytes -> 43 base64 chars once the single "=" pad is stripped.
    expect(key.fingerprint).toMatch(/^SHA256:[A-Za-z0-9+/]{43}$/);
  });
});

describe("parsePrivateKey rejections", () => {
  it("rejects a passphrase-protected key with an actionable message", () => {
    const encrypted = sshUtils.generateKeyPairSync("ed25519", {
      comment: "locked",
      passphrase: "test",
      cipher: "aes256-cbc",
      rounds: 16,
    });

    expect(() => parsePrivateKey(encrypted.private)).toThrow(SshKeyParseError);
    expect(() => parsePrivateKey(encrypted.private)).toThrow(/passphrase/i);
  });

  it("rejects a PKCS#8 ed25519 key, which ssh2 cannot use", () => {
    const { privateKey } = generateKeyPairSync("ed25519", {
      privateKeyEncoding: { type: "pkcs8", format: "pem" },
      publicKeyEncoding: { type: "spki", format: "pem" },
    });

    expect(() => parsePrivateKey(privateKey)).toThrow(SshKeyParseError);
  });

  it("rejects garbage", () => {
    expect(() => parsePrivateKey("not a key")).toThrow(SshKeyParseError);
  });

  it("rejects an empty string", () => {
    expect(() => parsePrivateKey("   ")).toThrow(SshKeyParseError);
  });
});
