import type { Context } from "../../trpc";

import { auditLogs } from "../../db/schema/index";

import { LogActionOptsI } from "./audit.interfaces";

/**
 * Insert an audit log entry. Never throws — logging failures must not
 * block the actual operation.
 */
export const logAction = async (
  ctx: Pick<Context, "db" | "user" | "ip">,
  opts: LogActionOptsI,
): Promise<void> => {
  try {
    await ctx.db.insert(auditLogs).values({
      userId: ctx.user?.id ?? null,
      userEmail: ctx.user?.email ?? null,
      action: opts.action,
      resourceType: opts.resourceType ?? null,
      resourceId: opts.resourceId ?? null,
      resourceName: opts.resourceName ?? null,
      metadata: opts.metadata ?? null,
      ip: ctx.ip,
    });
  } catch (err) {
    // Log to console but never propagate — audit failures are non-fatal
    console.error("[audit] Failed to write audit log:", err);
  }
};
