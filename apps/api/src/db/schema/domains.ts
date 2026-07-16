import {
  pgTable,
  uuid,
  varchar,
  integer,
  boolean,
  timestamp,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";

import { applications } from "./applications";

const domains = pgTable("domains", {
  id: uuid("id").defaultRandom().primaryKey(),
  applicationId: uuid("application_id")
    .references(() => applications.id, { onDelete: "cascade" })
    .notNull(),
  domain: varchar("domain", { length: 255 }).notNull(),
  port: integer("port").notNull(),
  https: boolean("https").default(true).notNull(),
  certificateResolver: varchar("certificate_resolver", { length: 50 }).default(
    "letsencrypt",
  ),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

const domainRelations = relations(domains, ({ one }) => ({
  application: one(applications, {
    fields: [domains.applicationId],
    references: [applications.id],
  }),
}));

type DomainT = typeof domains.$inferSelect;
type NewDomainT = typeof domains.$inferInsert;

export { domains, domainRelations, type DomainT, type NewDomainT };
