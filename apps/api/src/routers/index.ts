import { router } from "../trpc";
import { authRouter } from "./auth";
import { userRouter } from "./user";
import { taskRouter } from "./task";
import { logsRouter } from "./logs";
import { configRouter } from "./config";
import { auditRouter } from "./audit";
import { githubRouter } from "./github";
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
  github: githubRouter,
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
  task: taskRouter,
  config: configRouter,
});

export type AppRouter = typeof appRouter;
