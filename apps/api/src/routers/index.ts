import { router } from "../trpc";
import { authRouter } from "./auth";
import { userRouter } from "./user";
import { logsRouter } from "./logs";
import { auditRouter } from "./audit";
import { serverRouter } from "./server";
import { sshKeyRouter } from "./ssh-key";
import { statusRouter } from "./status";
import { composeRouter } from "./compose";
import { projectRouter } from "./project";
import { metricsRouter } from "./metrics";
import { templateRouter } from "./template";
import { databaseRouter } from "./database";
import { dashboardRouter } from "./dashboard";
import { applicationRouter } from "./application";
import { notificationRouter } from "./notification";
import { projectMemberRouter } from "./project-member";

export const appRouter = router({
  auth: authRouter,
  project: projectRouter,
  application: applicationRouter,
  database: databaseRouter,
  server: serverRouter,
  sshKey: sshKeyRouter,
  user: userRouter,
  audit: auditRouter,
  metrics: metricsRouter,
  notification: notificationRouter,
  dashboard: dashboardRouter,
  projectMember: projectMemberRouter,
  template: templateRouter,
  compose: composeRouter,
  status: statusRouter,
  logs: logsRouter,
});

export type AppRouter = typeof appRouter;
