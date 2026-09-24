/**
 * The shape of an import plan.
 *
 * It lives here rather than in the API because it is a contract between the
 * two: the planner produces it, the Settings page renders it, and a dry run is
 * only trustworthy if both agree on what the verbs mean.
 */

/**
 * - `create` — the resource is missing and will be created.
 * - `skip-exists` — it is already there; nothing is touched.
 * - `skip` — deliberately not imported, with a reason (an unknown user, a
 *   status page slug already taken).
 * - `error` — the manifest cannot be applied as written. **One error blocks
 *   the whole import**: it is a single transaction, and half a restore is
 *   worse than none.
 */
type PlanActionT = "create" | "skip-exists" | "skip" | "error";

type PlanKindT =
  | "project"
  | "application"
  | "database"
  | "stack"
  | "domain"
  | "task"
  | "member";

interface PlanItemI {
  kind: PlanKindT;
  /** Human path, e.g. `acme / api / api.acme.io`. */
  path: string;
  action: PlanActionT;
  reason?: string;
}

/**
 * A name already taken at the Docker layer. Not an error — the import writes
 * no containers — but DeployKit derives container names from resource names
 * (`dk-<name>`) and removes any container already holding the name when it
 * deploys, so an operator has to see this before confirming.
 */
interface ContainerNameConflictI {
  kind: "application" | "database" | "stack";
  containerName: string;
  importingInto: string;
  alreadyUsedBy: string;
}

interface ImportPlanI {
  items: PlanItemI[];
  warnings: string[];
  containerNameConflicts: ContainerNameConflictI[];
  /** Withheld values the secrets document did not supply. */
  missingSecrets: string[];
  counts: Record<PlanActionT, number>;
  secretsProvided: boolean;
  /** True once the writes have been committed. */
  applied: boolean;
}

export type {
  PlanActionT,
  PlanKindT,
  PlanItemI,
  ContainerNameConflictI,
  ImportPlanI,
};
