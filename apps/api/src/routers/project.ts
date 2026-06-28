import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { eq, inArray } from "drizzle-orm";

import {
  projects,
  applications,
  databases,
  projectMembers,
} from "../db/schema/index";

import { DockerService } from "../services/docker";
import {
  router,
  protectedProcedure,
  operatorProcedure,
  adminProcedure,
} from "../trpc";

import { createProjectSchema } from "@deploykit/shared";
import { logAction } from "../lib/audit";
import {
  getProjectRole,
  getAccessibleProjectIds,
  canView,
  canOperate,
} from "../lib/permissions";

const dockerService = new DockerService();

export const projectRouter = router({
  list: protectedProcedure.query(async ({ ctx }) => {
    // Global admins see everything; everyone else only their member projects
    if (ctx.user.role !== "admin") {
      const accessibleIds = await getAccessibleProjectIds(ctx.user);
      if (accessibleIds.length === 0) return [];
      return ctx.db.query.projects.findMany({
        where: inArray(projects.id, accessibleIds),
        with: {
          applications: true,
          databases: true,
        },
        orderBy: (projects, { desc }) => [desc(projects.createdAt)],
      });
    }

    return ctx.db.query.projects.findMany({
      with: {
        applications: true,
        databases: true,
      },
      orderBy: (projects, { desc }) => [desc(projects.createdAt)],
    });
  }),

  byId: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const role = await getProjectRole(ctx.user, input.id);
      if (!canView(role)) {
        // NOT_FOUND (not FORBIDDEN) so non-members can't probe which ids exist
        throw new TRPCError({ code: "NOT_FOUND", message: "Project not found" });
      }
      const project = await ctx.db.query.projects.findFirst({
        where: eq(projects.id, input.id),
        with: {
          applications: {
            with: { domains: true },
          },
          databases: true,
        },
      });
      if (!project)
        throw new TRPCError({ code: "NOT_FOUND", message: "Project not found" });
      return project;
    }),

  create: operatorProcedure
    .input(createProjectSchema)
    .mutation(async ({ ctx, input }) => {
      const [project] = await ctx.db.insert(projects).values(input).returning();
      // Membership is required for access, so make the creator a project admin
      // (global admins already have implicit access everywhere)
      if (ctx.user.role !== "admin") {
        await ctx.db.insert(projectMembers).values({
          projectId: project!.id,
          userId: ctx.user.id,
          role: "admin",
        });
      }
      await logAction(ctx, {
        action: "project.create",
        resourceType: "project",
        resourceId: project!.id,
        resourceName: project!.name,
      });
      return project!;
    }),

  update: operatorProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        name: z.string().min(1).max(100).optional(),
        description: z.string().max(500).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const role = await getProjectRole(ctx.user, input.id);
      if (!canOperate(role)) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Operator access required for this project",
        });
      }
      const { id, ...data } = input;
      const [project] = await ctx.db
        .update(projects)
        .set({ ...data, updatedAt: new Date() })
        .where(eq(projects.id, id))
        .returning();
      await logAction(ctx, {
        action: "project.update",
        resourceType: "project",
        resourceId: project!.id,
        resourceName: project!.name,
        metadata: data,
      });
      return project!;
    }),

  updateStatusPage: operatorProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        enabled: z.boolean(),
        slug: z
          .string()
          .regex(
            /^[a-z0-9-]+$/,
            "Use lowercase letters, numbers and hyphens only",
          )
          .min(1)
          .max(80)
          .optional(),
        title: z.string().max(255).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const role = await getProjectRole(ctx.user, input.id);
      if (!canOperate(role)) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Operator access required for this project",
        });
      }
      if (input.enabled && !input.slug) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "A slug is required to enable the status page",
        });
      }
      // Enforce slug uniqueness with a friendly error before hitting the
      // unique index constraint.
      if (input.slug) {
        const existing = await ctx.db.query.projects.findFirst({
          where: eq(projects.statusPageSlug, input.slug),
          columns: { id: true },
        });
        if (existing && existing.id !== input.id) {
          throw new TRPCError({
            code: "CONFLICT",
            message: "That status page slug is already in use",
          });
        }
      }
      const [project] = await ctx.db
        .update(projects)
        .set({
          statusPageEnabled: input.enabled,
          statusPageSlug: input.slug ?? null,
          statusPageTitle: input.title ?? null,
          updatedAt: new Date(),
        })
        .where(eq(projects.id, input.id))
        .returning();
      await logAction(ctx, {
        action: "project.update_status_page",
        resourceType: "project",
        resourceId: project!.id,
        resourceName: project!.name,
        metadata: { enabled: input.enabled, slug: input.slug },
      });
      return project!;
    }),

  delete: adminProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const project = await ctx.db.query.projects.findFirst({
        where: eq(projects.id, input.id),
      });

      // Stop all application containers
      const apps = await ctx.db.query.applications.findMany({
        where: eq(applications.projectId, input.id),
      });
      for (const app of apps) {
        if (app.containerId) {
          try {
            await dockerService.stopAndRemove(app.containerId);
          } catch {}
        }
      }

      // Stop all database containers
      const dbs = await ctx.db.query.databases.findMany({
        where: eq(databases.projectId, input.id),
      });
      for (const db of dbs) {
        if (db.containerId) {
          try {
            await dockerService.stopAndRemove(db.containerId);
          } catch {}
        }
      }

      // Cascade delete project + apps + dbs + deployments + domains
      await ctx.db.delete(projects).where(eq(projects.id, input.id));
      await logAction(ctx, {
        action: "project.delete",
        resourceType: "project",
        resourceId: input.id,
        resourceName: project?.name,
        metadata: { appsDeleted: apps.length, dbsDeleted: dbs.length },
      });
      return { success: true };
    }),
});
