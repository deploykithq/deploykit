import { memo } from "react";
import { Globe, Layers } from "lucide-react";

import { Card } from "@shared/components/card";
import { StatusBadge } from "@shared/components/status-badge";

import { timeAgo } from "@lib/utils";

interface ComposeCardPropsI {
  stack: any;
  onClick: () => void;
}

export const ComposeCard: React.FC<ComposeCardPropsI> = memo(
  function ComposeCard({ stack, onClick }) {
    const firstDomain = stack.domains?.[0];

    return (
      <Card hoverable onClick={onClick}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-9 h-9 rounded-lg bg-accent-muted flex items-center justify-center shrink-0">
              <Layers className="w-4 h-4 text-accent" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-medium truncate">{stack.name}</h3>
                <StatusBadge status={stack.status} />
              </div>
              <div className="flex items-center gap-3 mt-0.5">
                <span className="text-xs text-text-muted">
                  {stack.sourceType === "template"
                    ? (stack.templateId ?? "template")
                    : "compose"}
                </span>
                {firstDomain && (
                  <span className="text-xs text-accent flex items-center gap-1 truncate">
                    <Globe className="w-3 h-3 shrink-0" />
                    {firstDomain.domain}
                  </span>
                )}
              </div>
            </div>
          </div>
          <span className="text-xs text-text-muted mr-2 shrink-0">
            {timeAgo(stack.updatedAt)}
          </span>
        </div>
      </Card>
    );
  },
);
