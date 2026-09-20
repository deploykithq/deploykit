type LogServiceTypeT = "application" | "database" | "compose";

type LogLevelT = "error" | "warn" | "info" | "debug" | "fatal";

interface LogSearchPanelPropsI {
  serviceId: string;
  serviceType: LogServiceTypeT;
}

export type { LogServiceTypeT, LogLevelT, LogSearchPanelPropsI };
