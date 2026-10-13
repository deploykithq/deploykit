import { memo } from "react";
import { Puzzle } from "lucide-react";

import { Button } from "@shared/components/button";
import { Input } from "@shared/components/input";

import { SectionCard } from "@settings/infrastructure/ui/components/SectionCard";
import { useGameModKeys } from "@settings/infrastructure/ui/hooks/useGameModKeys";

const KEYS = [
  {
    key: "curseforge_api_key" as const,
    label: "CurseForge API key",
    help: "Needed to search and install CurseForge mods and modpacks. Get one at console.curseforge.com.",
  },
  {
    key: "steam_web_api_key" as const,
    label: "Steam Web API key",
    help: "Only needed to search the Workshop; pasting a Workshop link works without it. steamcommunity.com/dev/apikey",
  },
];

/** API keys for the mod catalogues. Stored encrypted; never shown again. */
export const GameModsSection: React.FC = memo(function GameModsSection() {
  const k = useGameModKeys();

  return (
    <SectionCard icon={Puzzle} title="Game mods">
      <div className="space-y-5">
        {KEYS.map(({ key, label, help }) => {
          const status = k.status?.[key];
          return (
            <div key={key} className="space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-medium">{label}</p>
                <span className="text-xs text-text-muted">
                  {status?.configured ? `Configured · ••••${status.last4}` : "Not set"}
                </span>
              </div>
              <p className="text-xs text-text-muted">{help}</p>
              <form
                className="flex gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (k.drafts[key].trim().length >= 8) k.save(key);
                }}
              >
                <Input
                  type="password"
                  autoComplete="off"
                  value={k.drafts[key]}
                  onChange={(e) => k.setDraft(key, e.target.value)}
                  placeholder={status?.configured ? "Replace the key" : "Paste the key"}
                  aria-label={label}
                />
                <Button
                  type="submit"
                  size="sm"
                  disabled={k.drafts[key].trim().length < 8 || k.pendingKey === key}
                >
                  {k.pendingKey === key ? "Checking…" : "Save"}
                </Button>
                {status?.configured && (
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => k.clear(key)}
                    disabled={k.pendingKey === key}
                  >
                    Clear
                  </Button>
                )}
              </form>
              {k.errorKey === key && <p className="text-xs text-danger">{k.error}</p>}
              {k.savedKey === key && <p className="text-xs text-green-400">Saved</p>}
            </div>
          );
        })}
      </div>
    </SectionCard>
  );
});
