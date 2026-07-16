import { pgTable, uuid, varchar, timestamp } from "drizzle-orm/pg-core";

const users = pgTable("users", {
  id: uuid("id").defaultRandom().primaryKey(),
  email: varchar("email", { length: 255 }).notNull().unique(),
  password: varchar("password", { length: 255 }).notNull(),
  role: varchar("role", { length: 20 }).default("viewer").notNull(), // admin | operator | viewer
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

type UserT = typeof users.$inferSelect;
type NewUserT = typeof users.$inferInsert;

export { users, type UserT, type NewUserT };
