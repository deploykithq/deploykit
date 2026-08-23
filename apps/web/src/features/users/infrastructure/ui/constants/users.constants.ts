import { Shield, ShieldCheck, Eye } from "lucide-react";

import { RoleValueT } from "@users/infrastructure/ui/interfaces/users.interfaces";

const ROLE_OPTIONS = [
  { value: "admin", label: "Admin" },
  { value: "operator", label: "Operator" },
  { value: "viewer", label: "Viewer" },
] as const;

const ROLE_DESCRIPTIONS: Record<RoleValueT, string> = {
  admin: "Full access — manage users, servers, and all operations",
  operator: "Deploy, manage apps/databases, view env vars",
  viewer: "Read-only — view projects, logs, and status",
};

const ROLE_ICONS: Record<RoleValueT, typeof Shield> = {
  admin: ShieldCheck,
  operator: Shield,
  viewer: Eye,
};

const ROLE_COLORS: Record<RoleValueT, string> = {
  admin: "text-accent bg-accent-muted",
  operator: "text-warning bg-warning/10",
  viewer: "text-text-secondary bg-surface-2",
};

export { ROLE_OPTIONS, ROLE_DESCRIPTIONS, ROLE_ICONS, ROLE_COLORS };
