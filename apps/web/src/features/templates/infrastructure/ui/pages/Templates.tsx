import { Loader2, Rocket } from "lucide-react";

import { Button } from "@shared/components/button";
import { Card } from "@shared/components/card";

import { DeployTemplateModal } from "@templates/infrastructure/ui/components/DeployTemplateModal";

import { useTemplates } from "@templates/infrastructure/ui/hooks/useTemplates";

import {
  CATEGORY_LABELS,
  CATEGORY_ORDER,
  getTemplateIcon,
} from "@templates/infrastructure/ui/constants/templates.constants";

export const TemplatesPage = () => {
  const { isLoading, grouped, selected, setSelected } = useTemplates();

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
          Deploy a database, a self-hosted app, or a full stack in one click.
        </p>
      </div>

      {CATEGORY_ORDER.filter((c) => grouped.has(c)).map((category) => (
        <section key={category} className="space-y-3">
          <h2 className="text-sm font-medium text-text-secondary">
            {CATEGORY_LABELS[category]}
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {(grouped.get(category) ?? []).map((template) => {
              const Icon = getTemplateIcon(template.icon);
              return (
                <Card key={template.id} className="flex flex-col gap-3">
                  <div className="flex items-start gap-3">
                    <div className="w-9 h-9 rounded-lg bg-surface-2 flex items-center justify-center text-accent shrink-0">
                      <Icon className="w-5 h-5" />
                    </div>
                    <div className="min-w-0">
                      <h3 className="text-sm font-medium">{template.name}</h3>
                      {template.tags && template.tags.length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-1">
                          {template.tags.map((tag) => (
                            <span
                              key={tag}
                              className="text-[10px] px-1.5 py-0.5 rounded bg-surface-2 text-text-muted"
                            >
                              {tag}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                  <p className="text-xs text-text-secondary flex-1">
                    {template.description}
                  </p>
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => setSelected(template)}
                  >
                    <Rocket className="w-3.5 h-3.5" />
                    Deploy
                  </Button>
                </Card>
              );
            })}
          </div>
        </section>
      ))}

      <DeployTemplateModal
        template={selected}
        open={selected !== null}
        onClose={() => setSelected(null)}
      />
    </div>
  );
};
