import { AlertTriangle, CheckCircle2, XCircle } from "lucide-react";

import type {
  OverallBannerI,
  ServiceStatusT,
  StatusMetaI,
} from "@status/infrastructure/ui/interfaces/status.interfaces";

const STATUS_META: Record<ServiceStatusT, StatusMetaI> = {
  operational: {
    label: "Operational",
    color: "text-green-500",
    Icon: CheckCircle2,
  },
  degraded: {
    label: "Degraded",
    color: "text-yellow-500",
    Icon: AlertTriangle,
  },
  down: { label: "Down", color: "text-red-500", Icon: XCircle },
};

const OVERALL_BANNER: Record<ServiceStatusT, OverallBannerI> = {
  operational: {
    text: "All systems operational",
    bg: "bg-green-500/10 border-green-500/30 text-green-600",
  },
  degraded: {
    text: "Some systems degraded",
    bg: "bg-yellow-500/10 border-yellow-500/30 text-yellow-600",
  },
  down: {
    text: "Major outage",
    bg: "bg-red-500/10 border-red-500/30 text-red-600",
  },
};

/** Cada cuánto se refresca la página pública de estado. */
const STATUS_REFETCH_MS = 30_000;

export { STATUS_META, OVERALL_BANNER, STATUS_REFETCH_MS };
