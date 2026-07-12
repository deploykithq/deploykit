import { AuditActionT, ResourceTypeT } from "./audit.types";

interface LogActionOptsI {
  action: AuditActionT;
  resourceType?: ResourceTypeT;
  resourceId?: string;
  resourceName?: string;
  metadata?: Record<string, unknown>;
}

export type { LogActionOptsI };
