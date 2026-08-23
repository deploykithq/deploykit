import { memo } from "react";

import {
  ROLE_ICONS,
  ROLE_COLORS,
} from "@users/infrastructure/ui/constants/users.constants";
import type { RoleValueT } from "@users/infrastructure/ui/interfaces/users.interfaces";

interface RoleBadgePropsI {
  role: string;
}

export const RoleBadge: React.FC<RoleBadgePropsI> = memo(function RoleBadge({
  role,
}) {
  const Icon = ROLE_ICONS[role as RoleValueT] ?? ROLE_ICONS.viewer;
  const colorClass = ROLE_COLORS[role as RoleValueT] ?? ROLE_COLORS.viewer;

  return (
    <span
      className={`inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-lg ${colorClass}`}
    >
      <Icon className="w-3 h-3" />
      {role}
    </span>
  );
});
