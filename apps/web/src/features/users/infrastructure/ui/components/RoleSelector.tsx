import { memo } from "react";

import { useUpdateRole } from "@users/infrastructure/ui/hooks/useUpdateRole";

import { RoleBadge } from "@users/infrastructure/ui/components";

import { ROLE_OPTIONS } from "@users/infrastructure/ui/constants/users.constants";

interface RoleSelectorPropsI {
  userId: string;
  role: string;
  isSelf: boolean;
}

export const RoleSelector: React.FC<RoleSelectorPropsI> = memo(
  function RoleSelector({ userId, role, isSelf }) {
    const { updateRole, isPending } = useUpdateRole();

    if (isSelf) {
      return <RoleBadge role={role} />;
    }

    return (
      <select
        value={role}
        onChange={(e) => updateRole(userId, e.target.value)}
        disabled={isPending}
        className="px-2.5 py-1.5 rounded-lg bg-surface-2 border border-border text-xs font-medium text-text-primary focus:outline-none focus:border-accent transition-colors cursor-pointer"
      >
        {ROLE_OPTIONS.map((r) => (
          <option key={r.value} value={r.value}>
            {r.label}
          </option>
        ))}
      </select>
    );
  },
);
