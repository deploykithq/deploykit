import { router } from "../trpc";
import { authRouter } from "./auth";
import { projectRouter } from "./project";
import { applicationRouter } from "./application";
import { databaseRouter } from "./database";
import { serverRouter } from "./server";
import { userRouter } from "./user";
import { auditRouter } from "./audit";
import { metricsRouter } from "./metrics";
import { notificationRouter } from "./notification";
import { dashboardRouter } from "./dashboard";
import { projectMemberRouter } from "./project-member";
import { templateRouter } from "./template";

export const appRouter = router({
  auth: authRouter,
  project: projectRouter,
  application: applicationRouter,
  database: databaseRouter,
  server: serverRouter,
  user: userRouter,
  audit: auditRouter,
  metrics: metricsRouter,
  notification: notificationRouter,
  dashboard: dashboardRouter,
  projectMember: projectMemberRouter,
  template: templateRouter,
});

export type AppRouter = typeof appRouter;
