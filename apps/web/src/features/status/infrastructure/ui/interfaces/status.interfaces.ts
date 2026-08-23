import type { LucideIcon } from "lucide-react";

type ServiceStatusT = "operational" | "degraded" | "down";

interface StatusMetaI {
  label: string;
  color: string;
  Icon: LucideIcon;
}

interface OverallBannerI {
  text: string;
  bg: string;
}

interface UptimePropsI {
  label: string;
  value: number | null;
}

export type { ServiceStatusT, StatusMetaI, OverallBannerI, UptimePropsI };
