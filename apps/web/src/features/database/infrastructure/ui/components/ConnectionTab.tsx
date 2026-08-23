import { memo } from "react";
import { Shield } from "lucide-react";

import { Card } from "@shared/components/card";
import { ConnectionField } from "@database/infrastructure/ui/components";

import { useAuthStore } from "@lib/auth";

import type { DatabaseI } from "@database/infrastructure/ui/interfaces/database.interfaces";

interface ConnectionTabPropsI {
  db: DatabaseI;
}

export const ConnectionTab: React.FC<ConnectionTabPropsI> = memo(
  function ConnectionTab({ db }) {
    const canViewSecrets = useAuthStore((s) => s.canWrite)();

    if (!canViewSecrets) {
      return (
        <Card>
          <div className="flex items-center gap-2 mb-4">
            <Shield className="w-4 h-4 text-accent" />
            <h3 className="text-sm font-medium">Connection</h3>
          </div>
          <div className="flex flex-col items-center py-8 text-center">
            <Shield className="w-8 h-8 text-text-muted mb-3" />
            <p className="text-sm text-text-secondary">
              Connection details are restricted to Operators and Admins.
            </p>
            <p className="text-xs text-text-muted mt-1">
              Contact your admin if you need database credentials.
            </p>
          </div>
        </Card>
      );
    }

    return (
      <Card>
        <div className="flex items-center gap-2 mb-4">
          <Shield className="w-4 h-4 text-accent" />
          <h3 className="text-sm font-medium">Connection</h3>
        </div>
        <div className="space-y-3">
          <ConnectionField
            label="Connection String"
            value={db.connectionString ?? ""}
            mono
          />
          <div className="grid grid-cols-3 gap-3">
            <ConnectionField label="Host (internal)" value={`dk-${db.name}`} />
            <ConnectionField label="Port" value={String(db.internalPort)} />
            <ConnectionField label="Username" value={db.dbUser ?? "N/A"} />
          </div>
          {db.type === "mongodb" && (
            <div className="flex items-center gap-2 text-xs">
              <span className="text-text-muted">Replica Set:</span>
              {db.replicaSet ? (
                <span className="px-1.5 py-0.5 rounded bg-accent/10 text-accent font-medium">
                  rs0 (enabled)
                </span>
              ) : (
                <span className="text-text-muted">Standalone</span>
              )}
            </div>
          )}
          <p className="text-xs text-text-muted">
            This database is only accessible within the{" "}
            <code className="text-accent">deploykit-network</code> Docker
            network. Use the internal hostname{" "}
            <code className="text-accent">dk-{db.name}</code> from your
            application's environment variables.
          </p>
        </div>
      </Card>
    );
  },
);
