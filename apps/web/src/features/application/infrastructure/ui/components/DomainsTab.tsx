import { memo } from "react";
import { ExternalLink, Globe, Plus, Trash2 } from "lucide-react";

import { Button } from "@shared/components/button";
import { Card } from "@shared/components/card";
import { Input } from "@shared/components/input";
import { Modal } from "@shared/components/modal";

import { useDomainsTab } from "@application/infrastructure/ui/hooks/useDomainsTab";

interface DomainsTabPropsI {
  app: any;
  applicationId: string;
}

export const DomainsTab: React.FC<DomainsTabPropsI> = memo(function DomainsTab({
  app,
  applicationId,
}) {
  const {
    showAdd,
    setShowAdd,
    newDomain,
    setNewDomain,
    newPort,
    setNewPort,
    adding,
    addDomain,
    removeDomain,
  } = useDomainsTab(app, applicationId);

  const appDomains = app.domains || [];

  return (
    <Card>
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-medium">Domains</h3>
          <Button size="sm" onClick={() => setShowAdd(true)}>
            <Plus className="w-3.5 h-3.5" /> Add Domain
          </Button>
        </div>

        {appDomains.length === 0 ? (
          <p className="text-sm text-text-muted py-4 text-center">
            No domains configured. Add a domain to access your app via HTTPS.
          </p>
        ) : (
          <div className="space-y-2">
            {appDomains.map((d: any) => (
              <div
                key={d.id}
                className="flex flex-col sm:flex-row sm:items-center sm:justify-between px-3 py-2 rounded-lg bg-surface-2 gap-2"
              >
                <div className="flex items-center gap-3">
                  <Globe className="w-4 h-4 text-accent" />
                  <div>
                    <a
                      href={`${d.https ? "https" : "http"}://${d.domain}`}
                      target="_blank"
                      rel="noreferrer"
                      className="text-sm font-medium text-accent hover:underline flex items-center gap-1"
                    >
                      {d.domain}
                      <ExternalLink className="w-3 h-3" />
                    </a>
                    <span className="text-xs text-text-muted">
                      port {d.port} · {d.https ? "HTTPS" : "HTTP"}
                    </span>
                  </div>
                </div>
                <Button
                  variant="danger"
                  size="sm"
                  onClick={() => removeDomain({ domainId: d.id })}
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </Button>
              </div>
            ))}
          </div>
        )}

        <p className="text-xs text-text-muted">
          Point your domain's A record to your server's IP, then add it here.
          SSL certificates are auto-provisioned via Let's Encrypt. Changes
          require a redeploy.
        </p>

        <Modal
          open={showAdd}
          onClose={() => setShowAdd(false)}
          title="Add Domain"
        >
          <div className="space-y-4">
            <Input
              label="Domain"
              value={newDomain}
              onChange={(e) => setNewDomain(e.target.value)}
              placeholder="app.example.com"
            />
            <Input
              label="Container Port"
              type="number"
              value={newPort}
              onChange={(e) => setNewPort(e.target.value)}
              placeholder="3000"
            />
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setShowAdd(false)}>
                Cancel
              </Button>
              <Button
                onClick={() =>
                  addDomain({
                    serviceId: applicationId,
                    domain: newDomain,
                    port: parseInt(newPort) || 3000,
                    https: true,
                  })
                }
                disabled={!newDomain || adding}
              >
                Add Domain
              </Button>
            </div>
          </div>
        </Modal>
      </div>
    </Card>
  );
});
