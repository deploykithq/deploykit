import type postgres from "postgres";

import { decrypt, encrypt } from "../../lib/encryption";
import { parsePrivateKey } from "../../lib/ssh-keygen";

interface LegacyServerRowI {
  id: string;
  name: string;
  ssh_key_content: string | null;
}

/**
 * One-shot migration of per-server private keys into the ssh_keys catalogue.
 *
 * This cannot be plain SQL: deriving the public key and fingerprint requires
 * decrypting the blob with ENCRYPTION_KEY and parsing it. Idempotent — once the
 * legacy columns are gone it returns immediately.
 */
export const backfillSshKeys = async (sql: postgres.Sql): Promise<void> => {
  const [column] = await sql<{ exists: boolean }[]>`
    SELECT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_name = 'servers' AND column_name = 'ssh_key_content'
    ) AS exists
  `;

  if (!column?.exists) return; // already migrated

  const rows = await sql<LegacyServerRowI[]>`
    SELECT id, name, ssh_key_content
    FROM servers
    WHERE ssh_key_content IS NOT NULL AND ssh_key_id IS NULL
  `;

  console.log(
    `[backfill] Migrating ${rows.length} server key(s) to the SSH key catalogue...`,
  );

  for (const row of rows) {
    try {
      const privateKey = decrypt(row.ssh_key_content!);
      const parsed = parsePrivateKey(privateKey);

      const [key] = await sql<{ id: string }[]>`
        INSERT INTO ssh_keys (name, description, type, public_key, private_key, fingerprint)
        VALUES (
          ${`Migrated — ${row.name}`},
          ${`Imported automatically from server "${row.name}"`},
          ${parsed.type},
          ${parsed.publicKey},
          ${encrypt(privateKey)},
          ${parsed.fingerprint}
        )
        RETURNING id
      `;

      await sql`UPDATE servers SET ssh_key_id = ${key!.id} WHERE id = ${row.id}`;
      console.log(`[backfill]   ${row.name} -> ${parsed.type} ${parsed.fingerprint}`);
    } catch (err) {
      // Never abort the run: the admin re-attaches a key from the UI afterwards.
      console.error(
        `[backfill]   Could not migrate the key for "${row.name}": ${(err as Error).message}`,
      );
    }
  }

  // Servers that only ever had ssh_key_path have no recoverable key material.
  const [orphans] = await sql<{ count: string }[]>`
    SELECT COUNT(*)::text AS count FROM servers
    WHERE ssh_key_id IS NULL AND is_local = false
  `;
  if (orphans && Number(orphans.count) > 0) {
    console.warn(
      `[backfill] ${orphans.count} remote server(s) have no SSH key and need one attached from the SSH Keys page.`,
    );
  }

  await sql`
    ALTER TABLE servers
      DROP COLUMN IF EXISTS ssh_key_content,
      DROP COLUMN IF EXISTS ssh_key_path
  `;
  console.log(
    "[backfill] Dropped servers.ssh_key_content and servers.ssh_key_path.",
  );
};
