import { createHash } from "crypto";
import ssh2 from "ssh2";

// ssh2 is CommonJS and exports `utils` as a nested object literal, which Node's
// CJS named-export detection does not pick up — `import { utils } from "ssh2"`
// throws at runtime under ESM. Reach it through the default export instead.
const sshUtils = ssh2.utils;

type SshKeyTypeT = "rsa" | "ed25519";

interface GeneratedKeyPairI {
  type: SshKeyTypeT;
  privateKey: string;
  publicKey: string;
  fingerprint: string;
}

interface ParsedKeyI {
  type: SshKeyTypeT;
  publicKey: string;
  fingerprint: string;
}

/** Thrown for anything a caller can fix: bad format, passphrase, unsupported algorithm. */
class SshKeyParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SshKeyParseError";
  }
}

const RSA_MODULUS_BITS = 4096;

/** SHA256 of the wire-format public key, as `ssh-keygen -lf` prints it. */
const fingerprintOf = (publicKeyWire: Buffer): string =>
  `SHA256:${createHash("sha256")
    .update(publicKeyWire)
    .digest("base64")
    .replace(/=+$/, "")}`;

/**
 * Validate a private key and derive its public half.
 * The public key is always derived, never trusted from client input.
 */
const parsePrivateKey = (pem: string): ParsedKeyI => {
  const trimmed = pem.trim();
  if (!trimmed) throw new SshKeyParseError("Private key is empty");

  const parsed = sshUtils.parseKey(trimmed);
  if (parsed instanceof Error) {
    const message = parsed.message.toLowerCase();
    if (message.includes("encrypted") || message.includes("passphrase")) {
      throw new SshKeyParseError(
        "Passphrase-protected keys are not supported — DeployKit cannot unlock them. Provide a key with no passphrase.",
      );
    }
    throw new SshKeyParseError(
      `Could not read the private key: ${parsed.message}`,
    );
  }

  const key = Array.isArray(parsed) ? parsed[0]! : parsed;

  const type: SshKeyTypeT | null =
    key.type === "ssh-ed25519"
      ? "ed25519"
      : key.type === "ssh-rsa"
        ? "rsa"
        : null;

  if (!type) {
    throw new SshKeyParseError(
      `Unsupported key algorithm "${key.type}" — only RSA and ED25519 are supported.`,
    );
  }

  const publicWire = key.getPublicSSH();
  const comment = key.comment || "deploykit";

  return {
    type,
    publicKey: `${key.type} ${publicWire.toString("base64")} ${comment}`,
    fingerprint: fingerprintOf(publicWire),
  };
};

/**
 * Generate a keypair in the formats DeployKit needs: an OpenSSH private key
 * (the only ed25519 format ssh2 can read) and a one-line authorized_keys entry.
 */
const generateKeyPair = (
  type: SshKeyTypeT,
  comment: string,
): GeneratedKeyPairI => {
  const pair =
    type === "rsa"
      ? sshUtils.generateKeyPairSync("rsa", { bits: RSA_MODULUS_BITS, comment })
      : sshUtils.generateKeyPairSync("ed25519", { comment });

  return {
    type,
    privateKey: pair.private,
    publicKey: pair.public.trim(),
    fingerprint: parsePrivateKey(pair.private).fingerprint,
  };
};

export {
  generateKeyPair,
  parsePrivateKey,
  fingerprintOf,
  SshKeyParseError,
  type SshKeyTypeT,
  type GeneratedKeyPairI,
  type ParsedKeyI,
};
