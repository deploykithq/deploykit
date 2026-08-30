import { memo } from "react";

import { Card } from "@shared/components/card";

import { TerminalTab as ContainerTerminal } from "@application/infrastructure/ui/components/TerminalTab";
import { ContainerSelector } from "@compose/infrastructure/ui/components/ContainerSelector";

import type { ComposeContainerI } from "@compose/infrastructure/ui/interfaces/compose.interfaces";

interface TerminalTabPropsI {
  containers: ComposeContainerI[];
  selectedContainerId: string | null;
  onSelectContainer: (id: string) => void;
}

/**
 * Terminal del stack.
 *
 * Reutiliza el terminal de aplicaciones tal cual: solo necesita un
 * `containerId`, y lo único que un stack añade es elegir cuál de sus
 * contenedores. Se le pasa `key` para que xterm se reinicie al cambiar de
 * contenedor en lugar de reusar la sesión anterior.
 */
export const TerminalTab: React.FC<TerminalTabPropsI> = memo(
  function TerminalTab({ containers, selectedContainerId, onSelectContainer }) {
    return (
      <div className="space-y-3">
        <Card>
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <h3 className="text-sm font-medium">Container</h3>
            <ContainerSelector
              containers={containers}
              value={selectedContainerId}
              onChange={onSelectContainer}
              emptyLabel="No running containers to attach to."
            />
          </div>
        </Card>

        {selectedContainerId && (
          <ContainerTerminal
            key={selectedContainerId}
            app={{ containerId: selectedContainerId }}
          />
        )}
      </div>
    );
  },
);
