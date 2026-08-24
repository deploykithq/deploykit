import { memo } from "react";

import { trpc } from "@lib/trpc";

import { STATUS_OPTIONS } from "@sessions/infrastructure/ui/constants/sessions.constants";

import type {
  FiltersI,
  SessionStatusFilterT,
} from "@sessions/infrastructure/ui/interfaces/sessions.interfaces";

interface FilterBarPropsI {
  filters: FiltersI;
  onChange: (f: FiltersI) => void;
}

const SELECT_CLASS =
  "text-sm px-3 py-1.5 rounded-lg border border-border bg-surface-1 focus:outline-none focus:ring-1 focus:ring-accent";

export const FilterBar: React.FC<FilterBarPropsI> = memo(function FilterBar({
  filters,
  onChange,
}) {
  const { data: users } = trpc.user.list.useQuery();

  return (
    <div className="flex items-center gap-3 flex-wrap">
      <select
        className={SELECT_CLASS}
        value={filters.status}
        onChange={(e) =>
          onChange({
            ...filters,
            status: e.target.value as SessionStatusFilterT,
          })
        }
      >
        {STATUS_OPTIONS.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>

      <select
        className={SELECT_CLASS}
        value={filters.userId}
        onChange={(e) => onChange({ ...filters, userId: e.target.value })}
      >
        <option value="">All users</option>
        {users?.map((user) => (
          <option key={user.id} value={user.id}>
            {user.email}
          </option>
        ))}
      </select>
    </div>
  );
});
