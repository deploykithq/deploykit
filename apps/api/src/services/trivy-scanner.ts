import { execFile } from "child_process";

import type {
  ScanResults,
  ScanSummaryI,
  ScanVulnerabilityI,
} from "../db/schema/deployments";

// Trivy image vulnerability scanner.
//
// Runs Trivy as an ephemeral container against an image already present in the
// local Docker daemon, reusing the docker CLI (no extra binary in the runtime
// image). The vuln DB is cached in a named volume so only the first scan pays
// the (large) download. Advisory: failures never abort a deploy.

const TRIVY_IMAGE = process.env.TRIVY_IMAGE || "aquasec/trivy:latest";
const TRIVY_CACHE_VOLUME =
  process.env.TRIVY_CACHE_VOLUME || "deploykit-trivy-cache";
const TRIVY_TIMEOUT_SECONDS = Number(process.env.TRIVY_TIMEOUT_SECONDS) || 300;
const DOCKER_SOCKET = process.env.DOCKER_SOCKET || "/var/run/docker.sock";

// Keep the full finding list (sorted most-severe first), with a safety cap so a
// pathological image can't bloat the deployment row.
const MAX_STORED = 1000;
const SEVERITY_ORDER = ["CRITICAL", "HIGH", "MEDIUM", "LOW", "UNKNOWN"];

export interface ScanResult {
  status: "passed" | "error";
  summary: ScanSummaryI;
  top: ScanVulnerabilityI[];
  error?: string;
}

interface ScanImageOpts {
  imageTag: string;
  onLog?: (msg: string) => void;
  timeoutMs?: number;
}

// Shape of the bits of Trivy's JSON report we consume.
interface TrivyVuln {
  VulnerabilityID?: string;
  PkgName?: string;
  Severity?: string;
  InstalledVersion?: string;
  FixedVersion?: string;
  Title?: string;
  PrimaryURL?: string;
}
interface TrivyReport {
  Results?: Array<{ Vulnerabilities?: TrivyVuln[] | null }>;
}

const emptySummary = (): ScanSummaryI => ({
  critical: 0,
  high: 0,
  medium: 0,
  low: 0,
  unknown: 0,
  total: 0,
});

function dockerRunArgs(imageTag: string): string[] {
  const timeout = `${TRIVY_TIMEOUT_SECONDS}s`;
  return [
    "run",
    "--rm",
    "-v",
    `${DOCKER_SOCKET}:/var/run/docker.sock`,
    "-v",
    `${TRIVY_CACHE_VOLUME}:/root/.cache/`,
    TRIVY_IMAGE,
    "image",
    "--scanners",
    "vuln",
    "--format",
    "json",
    "--quiet",
    "--timeout",
    timeout,
    imageTag,
  ];
}

function parseReport(json: string): {
  summary: ScanSummaryI;
  top: ScanVulnerabilityI[];
} {
  const report = JSON.parse(json) as TrivyReport;
  const summary = emptySummary();
  const vulns: ScanVulnerabilityI[] = [];

  for (const result of report.Results ?? []) {
    for (const v of result.Vulnerabilities ?? []) {
      const severity = (v.Severity || "UNKNOWN").toUpperCase();
      switch (severity) {
        case "CRITICAL":
          summary.critical++;
          break;
        case "HIGH":
          summary.high++;
          break;
        case "MEDIUM":
          summary.medium++;
          break;
        case "LOW":
          summary.low++;
          break;
        default:
          summary.unknown++;
      }
      summary.total++;
      vulns.push({
        id: v.VulnerabilityID || "UNKNOWN",
        pkg: v.PkgName || "",
        severity,
        installed: v.InstalledVersion || "",
        fixed: v.FixedVersion || "",
        title: v.Title || "",
        url: v.PrimaryURL || "",
      });
    }
  }

  // Most severe first, capped.
  vulns.sort(
    (a, b) =>
      SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity),
  );
  return { summary, top: vulns.slice(0, MAX_STORED) };
}

export function scanImage(opts: ScanImageOpts): Promise<ScanResult> {
  const { imageTag, onLog } = opts;
  // Give the process a bit more than Trivy's own timeout to wind down.
  const procTimeout = (opts.timeoutMs ?? TRIVY_TIMEOUT_SECONDS * 1000) + 30_000;

  return new Promise((resolve) => {
    execFile(
      "docker",
      dockerRunArgs(imageTag),
      { timeout: procTimeout, maxBuffer: 64 * 1024 * 1024 },
      (error, stdout, stderr) => {
        // Trivy exits 0 with a report even when vulns are found (we don't pass
        // --exit-code). A non-zero exit means Trivy/docker itself failed.
        if (error) {
          const msg = (stderr || error.message || "")
            .toString()
            .split("\n")
            .slice(0, 3)
            .join(" ")
            .trim();
          onLog?.(`Vulnerability scan failed: ${msg}\n`);
          resolve({
            status: "error",
            summary: emptySummary(),
            top: [],
            error: msg,
          });
          return;
        }

        try {
          const { summary, top } = parseReport(stdout);
          resolve({ status: "passed", summary, top });
        } catch (err: any) {
          onLog?.(`Could not parse scan report: ${err.message}\n`);
          resolve({
            status: "error",
            summary: emptySummary(),
            top: [],
            error: err.message,
          });
        }
      },
    );
  });
}

// Best-effort vuln-DB pre-warm so the first real deploy doesn't pay the download.
export function prewarmTrivyDb(): void {
  execFile(
    "docker",
    [
      "run",
      "--rm",
      "-v",
      `${TRIVY_CACHE_VOLUME}:/root/.cache/`,
      TRIVY_IMAGE,
      "image",
      "--download-db-only",
    ],
    { timeout: 300_000, maxBuffer: 16 * 1024 * 1024 },
    (error) => {
      if (error) {
        console.warn(
          "[trivy] DB pre-warm skipped:",
          error.message.split("\n")[0],
        );
      } else {
        console.log("[trivy] Vulnerability DB pre-warmed");
      }
    },
  );
}

export const scanConfig = {
  enabledByDefault: process.env.SCAN_ENABLED === "true",
  timeoutMs: TRIVY_TIMEOUT_SECONDS * 1000,
};
