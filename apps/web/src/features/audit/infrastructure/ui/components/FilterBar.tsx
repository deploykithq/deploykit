import { memo } from "react";
import { Search } from "lucide-react";

import type { FiltersI } from "@audit/infrastructure/ui/interfaces/audit.interfaces";

interface FilterBarPropsI {
  filters: FiltersI;
  onChange: (f: FiltersI) => void;
}

export const FilterBar: React.FC<FilterBarPropsI> = memo(function FilterBar({
  filters,
  onChange,
}) {
  return (
    <div className="flex items-center gap-3 flex-wrap">
      <div className="relative flex-1 min-w-48">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-text-muted" />
        <input
          className="w-full pl-8 pr-3 py-1.5 text-sm rounded-lg border border-border bg-surface-1 placeholder-text-muted focus:outline-none focus:ring-1 focus:ring-accent"
          placeholder="Search by user, resource or action…"
          value={filters.search}
          onChange={(e) => onChange({ ...filters, search: e.target.value })}
        />
      </div>

      <select
        className="text-sm px-3 py-1.5 rounded-lg border border-border bg-surface-1 focus:outline-none focus:ring-1 focus:ring-accent"
        value={filters.resourceType}
        onChange={(e) => onChange({ ...filters, resourceType: e.target.value })}
      >
        <option value="">All resources</option>
        {["application", "database", "project", "server", "user", "session"].map(
          (r) => (
            <option key={r} value={r}>
              {r.charAt(0).toUpperCase() + r.slice(1)}
            </option>
          ),
        )}
      </select>

      <select
        className="text-sm px-3 py-1.5 rounded-lg border border-border bg-surface-1 focus:outline-none focus:ring-1 focus:ring-accent"
        value={filters.action}
        onChange={(e) => onChange({ ...filters, action: e.target.value })}
      >
        <option value="">All actions</option>
        {[
          "auth",
          "project",
          "application",
          "database",
          "server",
          "user",
          "session",
        ].map((a) => (
          <option key={a} value={a}>
            {a.charAt(0).toUpperCase() + a.slice(1)}
          </option>
        ))}
      </select>
    </div>
  );
});
