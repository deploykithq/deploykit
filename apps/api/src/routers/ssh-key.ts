import { z } from "zod";
import { eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";

import { sshKeys, servers } from "../db/schema/index";

import { router, adminProcedure } from "../trpc";

import { encrypt } from "../lib/encryption";
import { logAction } from "../lib/audit/audit";
import {
  generateKeyPair,
  parsePrivateKey,
  SshKeyParseError,
} from "../lib/ssh-keygen";

import {
  createSshKeySchema,
  updateSshKeySchema,
  generateSshKeySchema,
} from "@deploykit/shared";

type SshKeyRowT = typeof sshKeys.$inferSelect & {
  servers?: Array<{ id: string; name: string }>;
};

/** Strip the private half — it must never leave the API once stored. */
const toPublicRow = (key: SshKeyRowT) => {
  const { privateKey: _privateKey, ...rest } = key;
  return { ...rest, servers: key.servers ?? [] };
};

export const sshKeyRouter = router({
  list: adminProcedure.query(async ({ ctx }) => {
    const rows = await ctx.db.query.sshKeys.findMany({
      with: { servers: { columns: { id: true, name: true } } },
      orderBy: (k, { desc }) => [desc(k.createdAt)],
    });
    return rows.map(toPublicRow);
  }),

  byId: adminProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const key = await ctx.db.query.sshKeys.findFirst({
        where: eq(sshKeys.id, input.id),
        with: { servers: { columns: { id: true, name: true } } },
      });
      if (!key) {
        throw new TRPCError({ code: "NOT_FOUND", message: "SSH key not found" });
      }
      return toPublicRow(key);
    }),

  /** Generates a keypair and returns it. Persists nothing — `create` stores it. */
  generate: adminProcedure
    .input(generateSshKeySchema)
    .mutation(async ({ ctx, input }) => {
      const comment = input.comment?.trim() || ctx.user.email;
      const key = generateKeyPair(input.type, comment);
      return {
        type: key.type,
        privateKey: key.privateKey,
        publicKey: key.publicKey,
        fingerprint: key.fingerprint,
      };
    }),

  create: adminProcedure
    .input(createSshKeySchema)
    .mutation(async ({ ctx, input }) => {
      let parsed;
      try {
        // The public half is always derived, so the two can never disagree.
        parsed = parsePrivateKey(input.privateKey);
      } catch (err) {
        if (err instanceof SshKeyParseError) {
          throw new TRPCError({ code: "BAD_REQUEST", message: err.message });
        }
        throw err;
      }

      const [key] = await ctx.db
        .insert(sshKeys)
        .values({
          name: input.name,
          description: input.description ?? null,
          type: parsed.type,
          publicKey: parsed.publicKey,
          privateKey: encrypt(input.privateKey.trim()),
          fingerprint: parsed.fingerprint,
          createdBy: ctx.user.id,
        })
        .returning();

      await logAction(ctx, {
        action: "ssh_key.create",
        resourceType: "ssh_key",
        resourceId: key!.id,
        resourceName: key!.name,
        metadata: { type: parsed.type, fingerprint: parsed.fingerprint },
      });

      return toPublicRow(key!);
    }),

  update: adminProcedure
    .input(updateSshKeySchema)
    .mutation(async ({ ctx, input }) => {
      const { id, ...data } = input;
      const [key] = await ctx.db
        .update(sshKeys)
        .set({ ...data, updatedAt: new Date() })
        .where(eq(sshKeys.id, id))
        .returning();

      if (!key) {
        throw new TRPCError({ code: "NOT_FOUND", message: "SSH key not found" });
      }

      await logAction(ctx, {
        action: "ssh_key.update",
        resourceType: "ssh_key",
        resourceId: key.id,
        resourceName: key.name,
        metadata: { ...data },
      });

      return toPublicRow(key);
    }),

  delete: adminProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const key = await ctx.db.query.sshKeys.findFirst({
        where: eq(sshKeys.id, input.id),
      });
      if (!key) {
        throw new TRPCError({ code: "NOT_FOUND", message: "SSH key not found" });
      }

      // The FK is ON DELETE RESTRICT; check first so the error names the servers.
      const inUse = await ctx.db.query.servers.findMany({
        where: eq(servers.sshKeyId, input.id),
        columns: { name: true },
      });
      if (inUse.length) {
        throw new TRPCError({
          code: "CONFLICT",
          message: `This key is in use by: ${inUse
            .map((s) => s.name)
            .join(", ")}. Detach it from those servers first.`,
        });
      }

      await ctx.db.delete(sshKeys).where(eq(sshKeys.id, input.id));

      await logAction(ctx, {
        action: "ssh_key.delete",
        resourceType: "ssh_key",
        resourceId: input.id,
        resourceName: key.name,
        metadata: { type: key.type, fingerprint: key.fingerprint },
      });

      return { success: true };
    }),
});
