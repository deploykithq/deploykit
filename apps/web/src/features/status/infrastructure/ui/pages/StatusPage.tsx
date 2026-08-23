import { Uptime } from "@status/infrastructure/ui/components";

import { useStatusPage } from "@status/infrastructure/ui/hooks/useStatusPage";

import {
  OVERALL_BANNER,
  STATUS_META,
} from "@status/infrastructure/ui/constants/status.constants";

export const StatusPage: React.FC = () => {
  const { data, isLoading, error } = useStatusPage();

  return (
    <div className="min-h-screen bg-surface-0 text-text-primary flex flex-col items-center px-4 py-12">
      <div className="w-full max-w-2xl space-y-6">
        {isLoading && (
          <p className="text-sm text-text-muted text-center py-20">Loading…</p>
        )}

        {error && (
          <div className="text-center py-20">
            <h1 className="text-xl font-semibold">Status page not found</h1>
            <p className="text-sm text-text-muted mt-2">
              This status page doesn’t exist or isn’t public.
            </p>
          </div>
        )}

        {data && (
          <>
            <header className="text-center space-y-1">
              <h1 className="text-2xl font-bold">{data.title}</h1>
              <p className="text-xs text-text-muted">
                Updated {new Date(data.updatedAt).toLocaleTimeString()}
              </p>
            </header>

            <div
              className={`rounded-xl border px-4 py-3 text-center font-medium ${OVERALL_BANNER[data.overall].bg}`}
            >
              {OVERALL_BANNER[data.overall].text}
            </div>

            {data.services.length === 0 ? (
              <p className="text-sm text-text-muted text-center py-8">
                No services are published on this status page yet.
              </p>
            ) : (
              <ul className="space-y-2">
                {data.services.map((s) => {
                  const meta = STATUS_META[s.status];
                  return (
                    <li
                      key={s.name}
                      className="bg-surface-1 border border-border rounded-xl px-4 py-3 flex items-center gap-4"
                    >
                      <meta.Icon className={`w-5 h-5 shrink-0 ${meta.color}`} />
                      <div className="flex-1 min-w-0">
                        <p className="font-medium truncate">{s.name}</p>
                        <p className={`text-xs ${meta.color}`}>{meta.label}</p>
                      </div>
                      <div className="flex items-center gap-4">
                        <Uptime label="24h" value={s.uptime["24h"]} />
                        <Uptime label="7d" value={s.uptime["7d"]} />
                        <Uptime label="90d" value={s.uptime["90d"]} />
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}

            <footer className="text-center pt-4">
              <p className="text-[11px] text-text-muted">Powered by DeployKit</p>
            </footer>
          </>
        )}
      </div>
    </div>
  );
};
