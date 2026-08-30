import {
  pgTable,
  uuid,
  varchar,
  integer,
  boolean,
  timestamp,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";

import { composeServices } from "./compose-services";

/**
 * A domain routed to one service inside a stack.
 *
 * Separate from `domains` because routing needs `service_name`: a stack has
 * many services, and Traefik labels have to land on the right one. An
 * application has exactly one container, so its table has no equivalent.
 */
const composeDomains = pgTable("compose_domains", {
  id: uuid("id").defaultRandom().primaryKey(),
  composeServiceId: uuid("compose_service_id")
    .references(() => composeServices.id, { onDelete: "cascade" })
    .notNull(),
  /** Key under `services:` in the Compose file. */
  serviceName: varchar("service_name", { length: 100 }).notNull(),
  domain: varchar("domain", { length: 255 }).notNull(),
  port: integer("port").notNull(),
  path: varchar("path", { length: 255 }),
  https: boolean("https").default(true).notNull(),
  certificateResolver: varchar("certificate_resolver", { length: 50 }).default(
    "letsencrypt",
  ),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

const composeDomainRelations = relations(composeDomains, ({ one }) => ({
  composeService: one(composeServices, {
    fields: [composeDomains.composeServiceId],
    references: [composeServices.id],
  }),
}));

type ComposeDomainT = typeof composeDomains.$inferSelect;
type NewComposeDomainT = typeof composeDomains.$inferInsert;

export {
  composeDomains,
  composeDomainRelations,
  type ComposeDomainT,
  type NewComposeDomainT,
};
