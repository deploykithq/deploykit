type LogServiceTypeT = "application" | "database" | "compose" | "game_server";

type LogLevelT = "error" | "warn" | "info" | "debug" | "fatal";

interface LogSearchPanelPropsI {
  serviceId: string;
  serviceType: LogServiceTypeT;
}

export type { LogServiceTypeT, LogLevelT, LogSearchPanelPropsI };
