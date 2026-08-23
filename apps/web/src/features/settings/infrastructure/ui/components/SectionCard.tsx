import { memo } from "react";
import type { LucideIcon } from "lucide-react";

import { Card } from "@shared/components/card";

interface SectionCardPropsI {
  icon: LucideIcon;
  title: string;
  children: React.ReactNode;
}

export const SectionCard: React.FC<SectionCardPropsI> = memo(
  function SectionCard({ icon: Icon, title, children }) {
    return (
      <Card>
        <div className="flex items-center gap-2 mb-4">
          <Icon className="w-4 h-4 text-accent" />
          <h3 className="text-sm font-medium">{title}</h3>
        </div>
        {children}
      </Card>
    );
  },
);
