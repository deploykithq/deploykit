import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { eq, and } from "drizzle-orm";

import { projectMembers, users, projects } from "../db/schema/index";
import { router, protectedProcedure } from "../trpc";
import { logAction } from "../lib/audit";
import { getProjectRole, isAdmin } from "../lib/permissions";
import { UserRole } from "@deploykit/shared";

export const projectMemberRouter = router({
  /**
   * List all members of a project.
   * Requires membership on the project (or global admin).
   */
  list: protectedProcedure
    .input(z.object({ projectId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const callerRole = await getProjectRole(ctx.user, input.projectId);
      if (!callerRole) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "You are not a member of this project",
        });
      }
      const members = await ctx.db.query.projectMembers.findMany({
        where: eq(projectMembers.projectId, input.projectId),
        with: {
          user: {
            columns: { id: true, email: true, role: true },
          },
        },
        orderBy: (m, { asc }) => [asc(m.createdAt)],
      });

      return members.map((m) => ({
        id: m.id,
        projectId: m.projectId,
        userId: m.userId,
        role: m.role,
        email: m.user.email,
        globalRole: m.user.role,
        createdAt: m.createdAt,
      }));
    }),

  /**
   * Add a member to a project with a specific role.
   * Requires admin role on the project.
   */
  add: protectedProcedure
    .input(
      z.object({
        projectId: z.string().uuid(),
        userId: z.string().uuid(),
        role: UserRole,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const callerRole = await getProjectRole(ctx.user, input.projectId);
      if (!isAdmin(callerRole)) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Admin access required to manage project members",
        });
      }

      // Verify user exists
      const user = await ctx.db.query.users.findFirst({
        where: eq(users.id, input.userId),
      });
      if (!user)
        throw new TRPCError({ code: "NOT_FOUND", message: "User not found" });

      // Global admins don't need per-project entries (they're always admin)
      if (user.role === "admin") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Global admins already have full access to all projects",
        });
      }

      // Check if already a member
      const existing = await ctx.db.query.projectMembers.findFirst({
        where: and(
          eq(projectMembers.projectId, input.projectId),
          eq(projectMembers.userId, input.userId),
        ),
      });

      if (existing) {
        throw new TRPCError({
          code: "CONFLICT",
          message:
            "User is already a member of this project. Use update to change their role.",
        });
      }

      const [member] = await ctx.db
        .insert(projectMembers)
        .values({
          projectId: input.projectId,
          userId: input.userId,
          role: input.role,
        })
        .returning();

      await logAction(ctx, {
        action: "project_member.add",
        resourceType: "project",
        resourceId: input.projectId,
        metadata: {
          userId: input.userId,
          email: user.email,
          role: input.role,
        },
      });

      return member!;
    }),

  /**
   * Update a member's role within a project.
   * Requires admin role on the project.
   */
  updateRole: protectedProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        role: UserRole,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const member = await ctx.db.query.projectMembers.findFirst({
        where: eq(projectMembers.id, input.id),
        with: { user: { columns: { email: true } } },
      });
      if (!member)
        throw new TRPCError({ code: "NOT_FOUND", message: "Member not found" });

      const callerRole = await getProjectRole(ctx.user, member.projectId);
      if (!isAdmin(callerRole)) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Admin access required to manage project members",
        });
      }

      const [updated] = await ctx.db
        .update(projectMembers)
        .set({ role: input.role, updatedAt: new Date() })
        .where(eq(projectMembers.id, input.id))
        .returning();

      await logAction(ctx, {
        action: "project_member.update",
        resourceType: "project",
        resourceId: member.projectId,
        metadata: {
          userId: member.userId,
          email: member.user.email,
          oldRole: member.role,
          newRole: input.role,
        },
      });

      return updated!;
    }),

  /**
   * Remove a member from a project.
   * Requires admin role on the project.
   */
  remove: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const member = await ctx.db.query.projectMembers.findFirst({
        where: eq(projectMembers.id, input.id),
        with: { user: { columns: { email: true } } },
      });
      if (!member)
        throw new TRPCError({ code: "NOT_FOUND", message: "Member not found" });

      const callerRole = await getProjectRole(ctx.user, member.projectId);
      if (!isAdmin(callerRole)) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Admin access required to manage project members",
        });
      }

      await ctx.db
        .delete(projectMembers)
        .where(eq(projectMembers.id, input.id));

      await logAction(ctx, {
        action: "project_member.remove",
        resourceType: "project",
        resourceId: member.projectId,
        metadata: {
          userId: member.userId,
          email: member.user.email,
          role: member.role,
        },
      });

      return { success: true };
    }),

  /**
   * Get the effective role for the current user on a project.
   * Used by the frontend to determine what UI to show.
   */
  myRole: protectedProcedure
    .input(z.object({ projectId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const role = await getProjectRole(ctx.user, input.projectId);
      return { role };
    }),

  /**
   * List users available to add to a project (not already members, not global admins).
   * Requires admin role on the project.
   */
  availableUsers: protectedProcedure
    .input(z.object({ projectId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const callerRole = await getProjectRole(ctx.user, input.projectId);
      if (!isAdmin(callerRole)) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Admin access required",
        });
      }

      // Get existing member user IDs
      const existingMembers = await ctx.db.query.projectMembers.findMany({
        where: eq(projectMembers.projectId, input.projectId),
        columns: { userId: true },
      });
      const memberIds = new Set(existingMembers.map((m) => m.userId));

      // Get all non-admin users not already in the project
      const allUsers = await ctx.db.query.users.findMany({
        columns: { id: true, email: true, role: true },
        orderBy: (u, { asc }) => [asc(u.email)],
      });

      return allUsers.filter((u) => u.role !== "admin" && !memberIds.has(u.id));
    }),
});
