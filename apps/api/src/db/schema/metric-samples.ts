import {
  pgTable,
  uuid,
  varchar,
  real,
  bigint,
  integer,
  timestamp,
  index,
  unique,
} from "drizzle-orm/pg-core";

const metricSamples = pgTable(
  "metric_samples",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    serviceId: uuid("service_id").notNull(),
    serviceType: varchar("service_type", { length: 20 }).notNull(), // application | database
    resolution: varchar("resolution", { length: 4 }).notNull(), // 1m | 1h
    bucket: timestamp("bucket").notNull(),
    cpuAvg: real("cpu_avg").notNull(), // percent
    cpuMax: real("cpu_max").notNull(), // percent
    memAvg: real("mem_avg").notNull(), // percent
    memMax: real("mem_max").notNull(), // percent
    memUsed: bigint("mem_used", { mode: "number" }).notNull(), // bytes (avg)
    diskUsed: bigint("disk_used", { mode: "number" }).notNull().default(0), // bytes (avg)
    netRx: bigint("net_rx", { mode: "number" }).notNull(), // cumulative bytes at bucket close
    netTx: bigint("net_tx", { mode: "number" }).notNull(),
    samples: integer("samples").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [
    unique("metric_samples_bucket_uq").on(t.serviceId, t.resolution, t.bucket),
    index("metric_samples_lookup_idx").on(t.serviceId, t.resolution, t.bucket),
  ],
);

type MetricSampleRowT = typeof metricSamples.$inferSelect;
type NewMetricSampleRowT = typeof metricSamples.$inferInsert;

export { metricSamples, type MetricSampleRowT, type NewMetricSampleRowT };
