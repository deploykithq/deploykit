import { memo } from "react";

import { MonitoringPanel } from "@metrics/infrastructure/ui/components/MonitoringPanel";

import type { GameServerTabPropsI } from "@game-server/infrastructure/ui/interfaces/game-server.interfaces";

/** CPU, memory and network of the server's container (serviceType "game_server"). */
export const MonitoringTab: React.FC<GameServerTabPropsI> = memo(function MonitoringTab({
  server,
}) {
  return (
    <div className="space-y-4">
      <MonitoringPanel serviceId={server.id} />
    </div>
  );
});
