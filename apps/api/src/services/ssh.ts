import { Client as SSHClient } from "ssh2";
import { shellEscape } from "../lib/shell";

export interface SSHConnectionOpts {
  host: string;
  port: number;
  username: string;
  /**
   * Decrypted private key in a format ssh2 accepts (OpenSSH, or PKCS#1 for RSA).
   * Resolved from the ssh_keys catalogue by services/ssh-key-resolver.ts.
   */
  privateKey: string;
}

interface SSHExecResult {
  stdout: string;
  stderr: string;
  code: number;
}

/**
 * Execute a command on a remote server via SSH.
 */
export function sshExec(
  opts: SSHConnectionOpts,
  command: string,
  timeoutMs = 30_000,
): Promise<SSHExecResult> {
  return new Promise((resolve, reject) => {
    const client = new SSHClient();
    const timer = setTimeout(() => {
      client.end();
      reject(new Error("SSH command timed out"));
    }, timeoutMs);

    client.on("ready", () => {
      client.exec(command, (err, stream) => {
        if (err) {
          clearTimeout(timer);
          client.end();
          return reject(err);
        }

        let stdout = "";
        let stderr = "";

        stream.on("data", (data: Buffer) => {
          stdout += data.toString();
        });

        stream.stderr.on("data", (data: Buffer) => {
          stderr += data.toString();
        });

        stream.on("close", (code: number) => {
          clearTimeout(timer);
          client.end();
          resolve({ stdout, stderr, code: code ?? 0 });
        });
      });
    });

    client.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });

    client.connect({
      host: opts.host,
      port: opts.port,
      username: opts.username,
      privateKey: opts.privateKey,
      readyTimeout: 10_000,
    });
  });
}

/**
 * Test SSH connection — just connect and disconnect.
 */
export function sshTestConnection(
  opts: SSHConnectionOpts,
): Promise<{ success: boolean; error?: string }> {
  return new Promise((resolve) => {
    const client = new SSHClient();
    const timer = setTimeout(() => {
      client.end();
      resolve({ success: false, error: "Connection timed out" });
    }, 10_000);

    client.on("ready", () => {
      clearTimeout(timer);
      client.end();
      resolve({ success: true });
    });

    client.on("error", (err) => {
      clearTimeout(timer);
      resolve({ success: false, error: err.message });
    });

    try {
      client.connect({
        host: opts.host,
        port: opts.port,
        username: opts.username,
        privateKey: opts.privateKey,
        readyTimeout: 10_000,
      });
    } catch (err: any) {
      clearTimeout(timer);
      resolve({ success: false, error: err.message });
    }
  });
}

/** Helper: prefix command with sudo when user is not root */
function sudo(opts: SSHConnectionOpts): string {
  return opts.username !== "root" ? "sudo " : "";
}

/**
 * Check if Docker is installed and running on the remote server.
 */
export async function sshDockerHealthCheck(opts: SSHConnectionOpts): Promise<{
  connected: boolean;
  dockerInstalled: boolean;
  dockerVersion?: string;
  containers?: number;
  images?: number;
  error?: string;
}> {
  // First check if SSH works
  const connTest = await sshTestConnection(opts);
  if (!connTest.success) {
    return { connected: false, dockerInstalled: false, error: connTest.error };
  }

  // Check if docker binary exists
  const whichResult = await sshExec(
    opts,
    "which docker 2>/dev/null || command -v docker 2>/dev/null || echo __NOT_FOUND__",
  );

  if (
    whichResult.code !== 0 ||
    whichResult.stdout.trim() === "__NOT_FOUND__" ||
    !whichResult.stdout.trim()
  ) {
    return {
      connected: true,
      dockerInstalled: false,
      error: "Docker is not installed on this server",
    };
  }

  const dockerPath = whichResult.stdout.trim();
  const s = sudo(opts);

  // Docker exists — get info (use sudo for non-root)
  try {
    const result = await sshExec(
      opts,
      `${s}${dockerPath} info --format "{{.ServerVersion}}|||{{.Containers}}|||{{.Images}}" 2>&1`,
    );

    if (result.code !== 0) {
      return {
        connected: true,
        dockerInstalled: true,
        error: `Docker installed but not working: ${result.stdout.trim() || result.stderr.trim()}`,
      };
    }

    const parts = result.stdout.trim().split("|||");
    return {
      connected: true,
      dockerInstalled: true,
      dockerVersion: parts[0],
      containers: parseInt(parts[1] || "0"),
      images: parseInt(parts[2] || "0"),
    };
  } catch (err: any) {
    return {
      connected: true,
      dockerInstalled: true,
      error: `Docker error: ${err.message}`,
    };
  }
}

/**
 * Get system resources from remote server.
 */
export async function sshGetServerInfo(opts: SSHConnectionOpts): Promise<{
  os?: string;
  cpuCores?: number;
  totalMemory?: number;
  totalDisk?: number;
  uptime?: string;
}> {
  try {
    const result = await sshExec(
      opts,
      [
        'echo "CPU:$(nproc 2>/dev/null || echo 0)"',
        "echo \"MEM:$(free -b 2>/dev/null | awk '/Mem:/{print $2}' || echo 0)\"",
        "echo \"DISK:$(df -B1 / 2>/dev/null | awk 'NR==2{print $2}' || echo 0)\"",
        'echo "UP:$(uptime -p 2>/dev/null || uptime)"',
        'echo "OS:$(cat /etc/os-release 2>/dev/null | grep PRETTY_NAME | cut -d= -f2 | tr -d \'"\' || uname -s)"',
      ].join(" && "),
    );

    if (result.code !== 0) return {};

    const lines = result.stdout.trim().split("\n");
    const data: Record<string, string> = {};
    for (const line of lines) {
      const [key, ...val] = line.split(":");
      if (key && val.length) data[key] = val.join(":").trim();
    }

    return {
      os: data.OS || undefined,
      cpuCores: parseInt(data.CPU || "0") || undefined,
      totalMemory: parseInt(data.MEM || "0") || undefined,
      totalDisk: parseInt(data.DISK || "0") || undefined,
      uptime: data.UP,
    };
  } catch {
    return {};
  }
}

/**
 * Install Docker on a remote server via the official install script.
 * Always uses sudo for non-root users.
 * Long timeout (5 min) since downloads + install take time.
 */
export async function sshInstallDocker(
  opts: SSHConnectionOpts,
): Promise<{ success: boolean; version?: string; error?: string }> {
  const s = sudo(opts);

  try {
    // 1. Install via official script (needs root/sudo)
    const install = await sshExec(
      opts,
      `curl -fsSL https://get.docker.com | ${s}sh 2>&1`,
      300_000,
    );

    if (install.code !== 0) {
      return {
        success: false,
        error:
          `Install script failed: ${install.stderr || install.stdout}`.slice(
            0,
            500,
          ),
      };
    }

    // 2. Enable + start
    await sshExec(opts, `${s}systemctl enable docker 2>&1`, 30_000);
    await sshExec(opts, `${s}systemctl start docker 2>&1`, 30_000);

    // 3. Add user to docker group if not root
    if (opts.username !== "root") {
      await sshExec(
        opts,
        `${s}usermod -aG docker ${shellEscape(opts.username)} 2>&1`,
        15_000,
      );
    }

    // 4. Verify (use sudo since group change needs re-login)
    const verify = await sshExec(opts, `${s}docker --version 2>&1`, 15_000);
    if (verify.code !== 0) {
      return { success: false, error: "Docker installed but failed to start" };
    }

    const version = verify.stdout
      .trim()
      .replace("Docker version ", "")
      .split(",")[0];
    return { success: true, version };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}
