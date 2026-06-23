import { useMemo, useState } from "react";
import { Loader2, Rocket } from "lucide-react";
import type { Template } from "@deploykit/shared";

import { Button, Card } from "@shared/components";

import { trpc } from "@lib/trpc";
import {
  getTemplateIcon,
  CATEGORY_LABELS,
  CATEGORY_ORDER,
} from "@templates/infrastructure/ui/constants/template.icons";
import { DeployTemplateModal } from "@templates/infrastructure/ui/components/DeployTemplateModal";

export const TemplatesPage = () => {
  const { data: templates, isLoading } = trpc.template.list.useQuery();
  const [selected, setSelected] = useState<Template | null>(null);

  const grouped = useMemo(() => {
    const map = new Map<string, Template[]>();
    for (const t of templates ?? []) {
      const list = map.get(t.category) ?? [];
      list.push(t);
      map.set(t.category, list);
    }
    return map;
  }, [templates]);

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
