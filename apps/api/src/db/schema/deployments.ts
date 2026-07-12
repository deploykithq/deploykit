import {
  pgTable,
  uuid,
  varchar,
  text,
  timestamp,
  jsonb,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";

import { applications } from "./applications";

interface ScanSummaryI {
  critical: number;
  high: number;
  medium: number;
  low: number;
  unknown: number;
  total: number;
}
interface ScanVulnerabilityI {
  id: string; // CVE / advisory id
  pkg: string; // affected package
  severity: string; // CRITICAL | HIGH | MEDIUM | LOW | UNKNOWN
  installed: string; // installed version
  fixed: string; // fixed version ("" if none)
  title: string;
  url: string; // primary reference URL ("" if none)
}
interface ScanResultsI {
  summary: ScanSummaryI;
  top: ScanVulnerabilityI[];
  scannedAt: number; // epoch ms
}

const deployments = pgTable("deployments", {
  id: uuid("id").defaultRandom().primaryKey(),
  applicationId: uuid("application_id")
    .references(() => applications.id, { onDelete: "cascade" })
    .notNull(),
  // Git info
  commitHash: varchar("commit_hash", { length: 40 }),
  commitMessage: text("commit_message"),
  // Status
  status: varchar("status", { length: 20 }).default("queued").notNull(),
  buildLogs: text("build_logs"),
  deployLogs: text("deploy_logs"),
  errorMessage: text("error_message"),
  // Image
  imageName: varchar("image_name", { length: 500 }),
  // Vulnerability scan (Trivy, advisory) — null when scanning is off for the app
  scanStatus: varchar("scan_status", { length: 20 }), // pending|scanning|passed|error|skipped
  scanResults: jsonb("scan_results").$type<ScanResultsI>(),
  scanFinishedAt: timestamp("scan_finished_at"),
  // Timing
  startedAt: timestamp("started_at"),
  finishedAt: timestamp("finished_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

const deploymentRelations = relations(deployments, ({ one }) => ({
  application: one(applications, {
    fields: [deployments.applicationId],
    references: [applications.id],
  }),
}));

type DeploymentT = typeof deployments.$inferSelect;
type NewDeploymentT = typeof deployments.$inferInsert;

export {
  deployments,
  deploymentRelations,
  type ScanSummaryI,
  type ScanVulnerabilityI,
  type ScanResultsI,
  type DeploymentT,
  type NewDeploymentT,
};
