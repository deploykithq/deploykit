import { eq } from "drizzle-orm";

import { db } from "../db/index";
import { sshKeys } from "../db/schema/index";

import { decrypt } from "../lib/encryption";

import type { SSHConnectionOpts } from "./ssh";

interface ServerConnectionFieldsI {
  name: string;
  host: string;
  port: number;
  username: string;
  sshKeyId: string | null;
}

/**
 * Build SSH options for a server by loading and decrypting its catalogue key.
 * Throws when the server has no key attached — the caller surfaces the message.
 */
export const resolveSshOpts = async (
  server: ServerConnectionFieldsI,
): Promise<SSHConnectionOpts> => {
  if (!server.sshKeyId) {
    throw new Error(
      `Server "${server.name}" has no SSH key configured. Attach one from the SSH Keys page.`,
    );
  }

  const key = await db.query.sshKeys.findFirst({
    where: eq(sshKeys.id, server.sshKeyId),
  });

  if (!key) {
    throw new Error(
      `The SSH key attached to "${server.name}" no longer exists.`,
    );
  }

  return {
    host: server.host,
    port: server.port,
    username: server.username,
    privateKey: decrypt(key.privateKey),
  };
};
