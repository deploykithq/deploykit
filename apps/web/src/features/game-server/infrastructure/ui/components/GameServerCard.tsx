import { memo } from "react";
import { Gamepad2, Network } from "lucide-react";

import { Card } from "@shared/components/card";
import { StatusBadge } from "@shared/components/status-badge";

import { timeAgo } from "@lib/utils";

import type { GameServerCardItemI } from "@game-server/infrastructure/ui/interfaces/game-server.interfaces";

interface GameServerCardPropsI {
  server: GameServerCardItemI;
  onClick: () => void;
}

export const GameServerCard: React.FC<GameServerCardPropsI> = memo(
  function GameServerCard({ server, onClick }) {
    const firstPort = server.ports[0];

    return (
      <Card hoverable onClick={onClick}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-9 h-9 rounded-lg bg-success/10 flex items-center justify-center shrink-0">
              <Gamepad2 className="w-4 h-4 text-success" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-medium truncate">{server.name}</h3>
                <StatusBadge status={server.status} />
              </div>
              <div className="flex items-center gap-3 mt-0.5">
                <span className="text-xs text-text-muted truncate">
                  {server.gameName}
                </span>
                {firstPort && (
                  <span className="text-xs text-text-secondary font-mono flex items-center gap-1 shrink-0">
                    <Network className="w-3 h-3" />
                    :{firstPort.hostPort}/{firstPort.protocol}
                  </span>
                )}
              </div>
            </div>
          </div>
          <span className="text-xs text-text-muted mr-2 shrink-0">
            {timeAgo(server.updatedAt)}
          </span>
        </div>
      </Card>
    );
  },
);
