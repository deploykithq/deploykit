import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { and, eq, isNull, sql } from "drizzle-orm";

import { db } from "../db/index";
import { projects, applications, alertEvents } from "../db/schema/index";
import { router, publicProcedure } from "../trpc";

type ServiceStatus = "operational" | "degraded" | "down";

// Availability proxy: we treat "an hour with recorded metrics" as "the service
// was up that hour" (a stopped container emits no metrics). This is an honest
// approximation, not a synthetic external probe. Buckets are counted across both
// the 1m (recent 48h) and 1h (older) tiers via date_trunc to the hour.
async function uptimePercent(
  serviceId: string,
  windowMs: number,
): Promise<number | null> {
  const windowSec = Math.floor(windowMs / 1000);
  const result = await db.execute(sql`
    SELECT count(DISTINCT date_trunc('hour', bucket))::int AS hours_present,
           min(bucket) AS first_bucket
    FROM metric_samples
    WHERE service_id = ${serviceId}
      AND bucket >= now() - make_interval(secs => ${windowSec})
  `);
  const row = (result as unknown as Array<{
    hours_present: number;
    first_bucket: string | null;
  }>)[0];
  if (!row || !row.first_bucket || row.hours_present === 0) return null;

  const firstMs = new Date(row.first_bucket).getTime();
  // Don't penalize services younger than the window for hours before they existed.
  const startMs = Math.max(Date.now() - windowMs, firstMs);
  const expectedHours = Math.max(
    1,
    Math.floor((Date.now() - startMs) / 3_600_000) + 1,
  );
  const pct = Math.min(100, (row.hours_present / expectedHours) * 100);
  return Math.round(pct * 10) / 10;
}

export const statusRouter = router({
  // Public, unauthenticated status page payload. Returns ONLY whitelisted,
  // non-sensitive fields for projects that opted in, and only the apps that
  // were explicitly flagged visible.
  getPublic: publicProcedure
    .input(z.object({ slug: z.string().min(1).max(80) }))
    .query(async ({ input }) => {
      const project = await db.query.projects.findFirst({
        where: and(
          eq(projects.statusPageSlug, input.slug),
          eq(projects.statusPageEnabled, true),
        ),
        columns: { id: true, name: true, statusPageTitle: true },
      });
      if (!project) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Status page not found",
        });
      }

      const apps = await db.query.applications.findMany({
        where: and(
          eq(applications.projectId, project.id),
          eq(applications.statusPageVisible, true),
        ),
        columns: { id: true, name: true, status: true },
        orderBy: (a, { asc }) => [asc(a.name)],
      });

      const services = await Promise.all(
        apps.map(async (app) => {
          let status: ServiceStatus;
          if (app.status !== "running") {
            status = "down";
          } else {
            const openAlert = await db.query.alertEvents.findFirst({
              where: and(
                eq(alertEvents.serviceId, app.id),
                isNull(alertEvents.resolvedAt),
              ),
              columns: { id: true },
            });
            status = openAlert ? "degraded" : "operational";
          }

          const [u24, u7, u90] = await Promise.all([
            uptimePercent(app.id, 24 * 60 * 60 * 1000),
            uptimePercent(app.id, 7 * 24 * 60 * 60 * 1000),
            uptimePercent(app.id, 90 * 24 * 60 * 60 * 1000),
          ]);

          return {
            name: app.name,
            status,
            uptime: { "24h": u24, "7d": u7, "90d": u90 },
          };
        }),
      );

      const overall: ServiceStatus = services.some((s) => s.status === "down")
        ? "down"
        : services.some((s) => s.status === "degraded")
          ? "degraded"
          : "operational";

      return {
        title: project.statusPageTitle || project.name,
        overall,
        services,
        updatedAt: Date.now(),
      };
    }),
});
