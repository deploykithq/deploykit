import { memo, useState } from "react";
import { BookOpen, Github, Globe, Rocket } from "lucide-react";

import { Button } from "@shared/components/button";
import { Card } from "@shared/components/card";

import { FallbackTemplateIcon } from "@templates/infrastructure/ui/constants/templates.constants";

import type { TemplateCardPropsI } from "@templates/infrastructure/ui/interfaces/templates.interfaces";

export const TemplateCard: React.FC<TemplateCardPropsI> = memo(
  function TemplateCard({ template, onDeploy }) {
    // El logo viene del registro remoto, que puede no responder. Si falla,
    // caemos al icono genérico en vez de dejar un hueco roto en la tarjeta.
    const [logoFailed, setLogoFailed] = useState(false);
    const showLogo = !!template.logoUrl && !logoFailed;

    const links = [
      { href: template.links?.github, icon: Github, label: "Source" },
      { href: template.links?.website, icon: Globe, label: "Website" },
      { href: template.links?.docs, icon: BookOpen, label: "Docs" },
    ].filter((l) => !!l.href);

    return (
      <Card className="flex flex-col gap-3">
        <div className="flex items-start gap-3">
          <div className="w-9 h-9 rounded-lg bg-surface-2 flex items-center justify-center text-accent shrink-0 overflow-hidden">
            {showLogo ? (
              <img
                src={template.logoUrl}
                alt=""
                className="w-6 h-6 object-contain"
                loading="lazy"
                onError={() => setLogoFailed(true)}
              />
            ) : (
              <FallbackTemplateIcon className="w-5 h-5" />
            )}
          </div>

          <div className="min-w-0 flex-1">
            <div className="flex items-baseline gap-2">
              <h3 className="text-sm font-medium truncate">{template.name}</h3>
              <span className="text-[10px] text-text-muted font-mono shrink-0">
                {template.version}
              </span>
            </div>

            {template.tags?.length > 0 && (
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

        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="secondary"
            onClick={() => onDeploy(template)}
            className="flex-1"
          >
            <Rocket className="w-3.5 h-3.5" />
            Deploy
          </Button>

          {links.map((link) => (
            <a
              key={link.label}
              href={link.href}
              target="_blank"
              rel="noreferrer"
              title={link.label}
              className="w-7 h-7 rounded-md flex items-center justify-center text-text-muted hover:text-text-primary hover:bg-surface-2 transition-colors shrink-0"
            >
              <link.icon className="w-3.5 h-3.5" />
            </a>
          ))}
        </div>
      </Card>
    );
  },
);
