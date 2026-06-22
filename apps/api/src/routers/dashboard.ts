import { desc, gte, isNull, inArray, and } from "drizzle-orm";

import {
  projects,
  deployments,
  applications,
  auditLogs,
  alertEvents,
} from "../db/schema/index";
import { router, protectedProcedure } from "../trpc";
import { getAccessibleProjectIds } from "../lib/permissions";

export const dashboardRouter = router({
  /**
   * Single query that returns everything the dashboard needs.
   * Admins see the whole instance; everyone else only sees the projects
   * they are a member of. Servers and the audit trail are admin-only.
   */
  summary: protectedProcedure.query(async ({ ctx }) => {
    const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const since7d = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const isGlobalAdmin = ctx.user.role === "admin";

    // Scope: project ids the user can see (null = unrestricted, admin)
    const accessibleIds = isGlobalAdmin
      ? null
      : await getAccessibleProjectIds(ctx.user);

    const emptySummary = {
      stats: {
        projects: 0,
        applications: 0,
        appsRunning: 0,
        appsError: 0,
        appsBuilding: 0,
        databases: 0,
        dbsRunning: 0,
        servers: 0,
        serversConnected: 0,
        openAlerts: 0,
        deploys24h: 0,
        deploys7d: 0,
      },
      projects: [] as any[],
      servers: [] as any[],
      recentDeploys: [] as any[],
      recentActivity: [] as any[],
    };

    if (accessibleIds && accessibleIds.length === 0) {
      return emptySummary;
    }

    const projectScope = accessibleIds
      ? inArray(projects.id, accessibleIds)
      : undefined;

    // Application ids in scope (used to filter deployments for non-admins)
    const scopedAppIds = accessibleIds
      ? (
          await ctx.db.query.applications.findMany({
            where: inArray(applications.projectId, accessibleIds),
            columns: { id: true },
          })
        ).map((a) => a.id)
      : null;

    const deploymentScope = (extra?: ReturnType<typeof gte>) => {
      if (!scopedAppIds) return extra;
      const scoped = inArray(deployments.applicationId, scopedAppIds);
      return extra ? and(scoped, extra) : scoped;
    };

    const [
      allProjects,
      allServers,
      recentDeploys,
      recentActivity,
      openAlerts,
      deploys24h,
      deploys7d,
    ] = await Promise.all([
      // Projects with apps + dbs
      ctx.db.query.projects.findMany({
        where: projectScope,
        with: {
          applications: {
            columns: {
              id: true,
              name: true,
              status: true,
              containerId: true,
              branch: true,
              updatedAt: true,
            },
          },
          databases: {
            columns: {
              id: true,
              name: true,
              status: true,
              type: true,
            },
          },
        },
        orderBy: [desc(projects.updatedAt)],
      }),

      // Servers (infrastructure details are admin-only)
      isGlobalAdmin
        ? ctx.db.query.servers.findMany({
            columns: {
              id: true,
              name: true,
              host: true,
              status: true,
              isLocal: true,
              totalCpu: true,
              totalMemory: true,
              totalDisk: true,
              dockerVersion: true,
              lastHealthCheck: true,
            },
            orderBy: (servers, { desc }) => [desc(servers.createdAt)],
          })
        : Promise.resolve([]),

      // Recent deployments across visible apps (last 12)
      scopedAppIds && scopedAppIds.length === 0
        ? Promise.resolve([])
        : ctx.db.query.deployments.findMany({
            where: deploymentScope(),
            with: {
              application: {
                columns: { id: true, name: true, projectId: true },
              },
            },
            orderBy: [desc(deployments.createdAt)],
            limit: 12,
          }),

      // Recent activity (audit trail is admin-only)
      isGlobalAdmin
        ? ctx.db.query.auditLogs.findMany({
            orderBy: [desc(auditLogs.createdAt)],
            limit: 20,
            columns: {
              id: true,
              userEmail: true,
              action: true,
              resourceType: true,
              resourceName: true,
              createdAt: true,
            },
          })
        : Promise.resolve([]),

      // Open alerts count (instance-wide, admin-only; others see 0)
      isGlobalAdmin
        ? ctx.db.$count(alertEvents, isNull(alertEvents.resolvedAt))
        : Promise.resolve(0),

      // Deploy counts (scoped for non-admins)
      scopedAppIds && scopedAppIds.length === 0
        ? Promise.resolve(0)
        : ctx.db.$count(
            deployments,
            deploymentScope(gte(deployments.createdAt, since24h)),
          ),
      scopedAppIds && scopedAppIds.length === 0
        ? Promise.resolve(0)
        : ctx.db.$count(
            deployments,
            deploymentScope(gte(deployments.createdAt, since7d)),
          ),
    ]);

    // Aggregate stats
    const allApps = allProjects.flatMap((p) => p.applications);
    const allDbs = allProjects.flatMap((p) => p.databases);

    const stats = {
      projects: allProjects.length,
      applications: allApps.length,
      appsRunning: allApps.filter((a) => a.status === "running").length,
      appsError: allApps.filter(
        (a) => a.status === "error" || a.status === "stopped",
      ).length,
      appsBuilding: allApps.filter(
        (a) => a.status === "building" || a.status === "deploying",
      ).length,
      databases: allDbs.length,
      dbsRunning: allDbs.filter((d) => d.status === "running").length,
      servers: allServers.length,
      serversConnected: allServers.filter((s) => s.status === "connected")
        .length,
      openAlerts: Number(openAlerts),
      deploys24h: Number(deploys24h),
      deploys7d: Number(deploys7d),
    };

    return {
      stats,
      projects: allProjects,
      servers: allServers,
      recentDeploys,
      recentActivity,
    };
  }),
});
