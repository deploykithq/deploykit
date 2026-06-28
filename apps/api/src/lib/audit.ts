import type { Context } from "../trpc";
import { auditLogs } from "../db/schema/index";

export type AuditAction =
  // Auth
  | "auth.login"
  | "auth.logout"
  | "auth.register"
  | "auth.change_password"
  | "auth.update_profile"
  // Projects
  | "project.create"
  | "project.update"
  | "project.update_status_page"
  | "project.delete"
  // Applications
  | "application.create"
  | "application.update"
  | "application.delete"
  | "application.deploy"
  | "application.stop"
  | "application.restart"
  | "application.update_env"
  | "application.add_domain"
  | "application.remove_domain"
  // Databases
  | "database.create"
  | "database.delete"
  | "database.stop"
  | "database.restart"
  | "database.backup"
  | "database.restore"
  | "database.update_backup_config"
  // Servers
  | "server.create"
  | "server.update"
  | "server.delete"
  // Users (admin actions)
  | "user.create"
  | "user.update_role"
  | "user.reset_password"
  | "user.delete"
  // Notifications
  | "notification.create"
  | "notification.update"
  | "notification.delete"
  // Project members
  | "project_member.add"
  | "project_member.update"
  | "project_member.remove";

export type ResourceType =
  | "project"
  | "application"
  | "database"
  | "server"
  | "user"
  | "notification_channel";

interface LogActionOpts {
  action: AuditAction;
  resourceType?: ResourceType;
  resourceId?: string;
  resourceName?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Insert an audit log entry. Never throws — logging failures must not
 * block the actual operation.
 */
export async function logAction(
  ctx: Pick<Context, "db" | "user" | "ip">,
  opts: LogActionOpts,
): Promise<void> {
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
}
