import { memo } from "react";
import { Card } from "@shared/components/card";
import { StatusBadge } from "@shared/components/status-badge";

import { timeAgo } from "@lib/utils";

import { DB_TYPE_EMOJI } from "@database/infrastructure/ui/constants/database.constants";
import type { ProjectDatabaseI } from "@project/infrastructure/ui/interfaces/project.interfaces";

interface DatabaseCardPropsI {
  db: ProjectDatabaseI;
  onClick: () => void;
}

export const DatabaseCard: React.FC<DatabaseCardPropsI> = memo(
  function DatabaseCard({ db, onClick }) {
    return (
      <Card hoverable onClick={onClick}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-warning/10 flex items-center justify-center text-base">
              {DB_TYPE_EMOJI[db.type] ?? "💾"}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-medium">{db.name}</h3>
                <StatusBadge status={db.status} />
              </div>
              <span className="text-xs text-text-muted">
                {db.type} {db.version && `v${db.version}`} · port{" "}
                {db.internalPort}
              </span>
            </div>
          </div>
          <span className="text-xs text-text-muted">
            {timeAgo(db.updatedAt)}
          </span>
        </div>
      </Card>
    );
  },
);
