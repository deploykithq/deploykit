import { Loader2, Search, WifiOff, X } from "lucide-react";

import { Input } from "@shared/components/input";

import { DeployTemplateModal } from "@templates/infrastructure/ui/components/DeployTemplateModal";
import { TemplateCard } from "@templates/infrastructure/ui/components/TemplateCard";

import { useTemplates } from "@templates/infrastructure/ui/hooks/useTemplates";

import { cn } from "@lib/utils";

import { VISIBLE_TAG_FILTERS } from "@templates/infrastructure/ui/constants/templates.constants";

export const TemplatesPage = () => {
  const {
    isLoading,
    templates,
    filtered,
    tags,
    query,
    setQuery,
    activeTag,
    setActiveTag,
    selected,
    setSelected,
    source,
  } = useTemplates();

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64 text-text-muted">
        <Loader2 className="w-5 h-5 animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Templates</h1>
        <p className="text-sm text-text-secondary mt-0.5">
          Deploy a ready-made stack in one click. Passwords and keys are
          generated per deployment.
        </p>
      </div>

      {source === "bundled" && (
        <div className="flex items-start gap-2.5 rounded-lg border border-yellow-500/30 bg-yellow-900/10 p-3">
          <WifiOff className="w-4 h-4 text-yellow-600 shrink-0 mt-0.5" />
          <p className="text-xs text-text-secondary">
            The template registry is unreachable, so this is the catalogue
            bundled with DeployKit. It may be older than what is published.
          </p>
        </div>
      )}

      <div className="space-y-3">
        <div className="relative max-w-md">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-text-muted pointer-events-none" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search templates…"
            className="pl-9"
            autoComplete="off"
          />
        </div>

        {tags.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {tags.slice(0, VISIBLE_TAG_FILTERS).map(({ tag, count }) => (
              <button
                key={tag}
                type="button"
                onClick={() => setActiveTag(activeTag === tag ? null : tag)}
                className={cn(
                  "flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full border transition-colors",
                  activeTag === tag
                    ? "bg-accent-muted border-accent text-text-primary"
                    : "border-border text-text-secondary hover:text-text-primary",
                )}
              >
                {tag}
                <span className="text-text-muted">{count}</span>
                {activeTag === tag && <X className="w-3 h-3" />}
              </button>
            ))}
          </div>
        )}
      </div>

      {filtered.length === 0 ? (
        <div className="text-center py-16">
          <p className="text-sm text-text-secondary">
            No templates match{query ? ` “${query}”` : ""}
            {activeTag ? ` in “${activeTag}”` : ""}.
          </p>
          {(query || activeTag) && (
            <button
              type="button"
              onClick={() => {
                setQuery("");
                setActiveTag(null);
              }}
              className="text-xs text-accent hover:underline mt-2"
            >
              Clear filters
            </button>
          )}
        </div>
      ) : (
        <>
          <p className="text-xs text-text-muted">
            {filtered.length} of {templates.length} templates
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {filtered.map((template) => (
              <TemplateCard
                key={template.id}
                template={template}
                onDeploy={setSelected}
              />
            ))}
          </div>
        </>
      )}

      <DeployTemplateModal
        template={selected}
        open={selected !== null}
        onClose={() => setSelected(null)}
      />
    </div>
  );
};
