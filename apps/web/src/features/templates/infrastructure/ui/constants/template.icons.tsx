import {
  Database,
  Workflow,
  Activity,
  BarChart3,
  Boxes,
  Layers,
  Package,
  Mail,
  KeyRound,
  Rss,
  GitBranch,
  Gauge,
  StickyNote,
  BellRing,
  Code,
  type LucideIcon,
} from "lucide-react";
import type { TemplateCategory } from "@deploykit/shared";

const ICONS: Record<string, LucideIcon> = {
  Database,
  Workflow,
  Activity,
  BarChart3,
  Boxes,
  Layers,
  Package,
  Mail,
  KeyRound,
  Rss,
  GitBranch,
  Gauge,
  StickyNote,
  BellRing,
  Code,
};

export const getTemplateIcon = (name: string): LucideIcon =>
  ICONS[name] ?? Package;

export const CATEGORY_LABELS: Record<TemplateCategory, string> = {
  database: "Databases",
  selfhosted: "Self-hosted apps",
  stack: "Stacks",
  app: "Starter apps",
};

export const CATEGORY_ORDER: TemplateCategory[] = [
  "stack",
  "selfhosted",
  "app",
  "database",
];
