import { createCipheriv, createDecipheriv, randomBytes } from "crypto";

const ALGORITHM = "aes-256-gcm";

const getKey = (): Buffer => {
  const key = process.env.ENCRYPTION_KEY;
  if (!key) {
    throw new Error(
      "ENCRYPTION_KEY must be set. Generate with: openssl rand -hex 32",
    );
  }

  // Key derivation uses UTF-8 encoding (first 32 bytes) for backwards
  // compatibility with existing encrypted data. Changing this would
  // break decryption of all previously stored secrets.
  const raw = Buffer.from(key, "utf-8");
  if (raw.length < 32) {
    throw new Error(
      "ENCRYPTION_KEY too short (need at least 32 bytes). " +
        "Generate with: openssl rand -hex 32",
    );
  }
  return raw.subarray(0, 32);
};

const encrypt = (text: string): string => {
  const key = getKey();
  const iv = randomBytes(16);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  let encrypted = cipher.update(text, "utf8", "hex");
  encrypted += cipher.final("hex");
  const authTag = cipher.getAuthTag().toString("hex");
  // Format: iv:authTag:encrypted
  return `${iv.toString("hex")}:${authTag}:${encrypted}`;
};

const decrypt = (encryptedText: string): string => {
  const key = getKey();
  const [ivHex, authTagHex, encrypted] = encryptedText.split(":");
  if (!ivHex || !authTagHex || !encrypted) {
    throw new Error("Invalid encrypted text format");
  }
  const iv = Buffer.from(ivHex, "hex");
  const authTag = Buffer.from(authTagHex, "hex");
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  let decrypted = decipher.update(encrypted, "hex", "utf8");
  decrypted += decipher.final("utf8");
  return decrypted;
};

const encryptEnvVars = (vars: Record<string, string>): string => {
  return encrypt(JSON.stringify(vars));
};

const decryptEnvVars = (encrypted: string): Record<string, string> => {
  return JSON.parse(decrypt(encrypted));
};

const generatePassword = (length = 24): string => {
  return randomBytes(length).toString("base64url").slice(0, length);
};

export { encrypt, decrypt, encryptEnvVars, decryptEnvVars, generatePassword };
