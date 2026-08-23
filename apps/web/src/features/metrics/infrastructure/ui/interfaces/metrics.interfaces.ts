import { TREND_RANGES } from "@metrics/infrastructure/ui/constants/metrics.constants";

type TrendRangeT = (typeof TREND_RANGES)[number];

type ServiceTypeT = "application" | "database";

interface CreateRuleFormI {
  serviceType: ServiceTypeT;
  serviceId: string;
  metric: string;
  operator: string;
  threshold: number;
  channel: string;
  channelUrl: string;
  cooldown: number;
}

interface AlertServiceI {
  id: string;
  name: string;
  type: ServiceTypeT;
}

interface MetricsHistoryPropsI {
  serviceId: string;
  containerId: string | null;
}

interface MetricsTrendChartPropsI {
  serviceId: string;
}

interface RuleCardPropsI {
  rule: any;
}

interface CreateRuleModalPropsI {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
}

export type {
  TrendRangeT,
  ServiceTypeT,
  CreateRuleFormI,
  AlertServiceI,
  MetricsHistoryPropsI,
  MetricsTrendChartPropsI,
  RuleCardPropsI,
  CreateRuleModalPropsI,
};
