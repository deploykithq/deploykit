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

interface RuleCardPropsI {
  rule: any;
}

interface CreateRuleModalPropsI {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
}

/** Un punto tal y como lo devuelve `metrics.timeseries`. */
interface TimeseriesPointI {
  ts: number;
  cpu: number;
  cpuMax: number;
  mem: number;
  memMax: number;
  memUsed: number;
  disk: number;
  netRx: number;
  netTx: number;
}

/** Un punto ya listo para pintar: red convertida a caudal. */
interface ChartPointI {
  ts: number;
  cpu: number;
  cpuMax: number;
  memUsed: number;
  memPercent: number;
  disk: number;
  rxPerSec: number | null;
  txPerSec: number | null;
}

interface ChartSeriesI {
  key: keyof ChartPointI;
  label: string;
  color: string;
  /**
   * Área rellena. Por defecto sí: da volumen a una serie sola y dibuja la
   * envolvente de pico. Se apaga cuando dos entidades distintas comparten eje
   * (red in/out), porque el relleno de una tapa el de la otra.
   */
  fill?: boolean;
  fillOpacity?: number;
  strokeWidth?: number;
}

interface MetricChartPropsI {
  data: ChartPointI[];
  series: ChartSeriesI[];
  formatValue: (value: number) => string;
  /** Ticks del eje Y. Por defecto `formatValue`, que suele ser demasiado
   *  preciso para un eje (25.0% frente a 25%). */
  formatAxis?: (value: number) => string;
  range: TrendRangeT;
  domain?: [number, number];
}

interface ChartTooltipPropsI {
  series: ChartSeriesI[];
  formatValue: (value: number) => string;
  active?: boolean;
  label?: number;
  payload?: Array<{ dataKey?: string | number; value?: number }>;
}

interface MetricPanelPropsI extends MetricChartPropsI {
  title: string;
  value: string;
  /** Etiqueta de la línea de cabecera. "Used" para CPU/memoria/disco. */
  valueLabel?: string;
  limit?: string;
  /** Sin valor, la tarjeta no pinta barra de progreso (no hay límite). */
  percent?: number;
  isLoading: boolean;
}

interface MonitoringPanelPropsI {
  serviceId: string;
}

export type {
  TrendRangeT,
  ServiceTypeT,
  CreateRuleFormI,
  AlertServiceI,
  RuleCardPropsI,
  CreateRuleModalPropsI,
  TimeseriesPointI,
  ChartPointI,
  ChartSeriesI,
  MetricChartPropsI,
  ChartTooltipPropsI,
  MetricPanelPropsI,
  MonitoringPanelPropsI,
};
