import { createHmac } from "crypto";
import { getIO } from "../lib/socket";
import { assertSafeUrl } from "../lib/ssrf";
import { eq, and, sql } from "drizzle-orm";
import { db } from "../db/index";
import {
  notificationChannels,
  type NotificationEvent,
} from "../db/schema/index";

export interface NotificationPayload {
  event: NotificationEvent;
  projectId: string;
  title: string;
  message: string;
  meta?: {
    applicationId?: string;
    applicationName?: string;
    databaseId?: string;
    databaseName?: string;
    deploymentId?: string;
    commitHash?: string;
    branch?: string;
    error?: string;
    duration?: string;
    [key: string]: unknown;
  };
}

export interface AlertNotifyPayload {
  ruleId: string;
  eventId: string;
  serviceName: string;
  serviceType: string;
  metric: string;
  value: number;
  threshold: number;
  operator: string;
  message: string;
}

export async function fireNotification(
  payload: NotificationPayload,
): Promise<void> {
  try {
    const channels = await db.query.notificationChannels.findMany({
      where: and(
        eq(notificationChannels.enabled, true),
        sql`(${notificationChannels.projectId} = ${payload.projectId} OR ${notificationChannels.projectId} IS NULL)`,
      ),
    });

    const matching = channels.filter((ch) => {
      const events = ch.events as string[];
      return events.includes(payload.event);
    });

    if (matching.length === 0) return;

    const results = await Promise.allSettled(
      matching.map((ch) =>
        dispatchToChannel(
          ch.type,
          ch.config as Record<string, string>,
          payload,
        ),
      ),
    );

    for (let i = 0; i < results.length; i++) {
      const result = results[i]!;
      if (result.status === "rejected") {
        console.error(
          `[notifier] Failed → ${matching[i]!.type} "${matching[i]!.name}": ${result.reason}`,
        );
      }
    }
  } catch (err) {
    console.error("[notifier] Error dispatching notifications:", err);
  }
}

/**
 * Legacy alert notify — emits via Socket.IO + fires through new system
 */
export async function notify(
  channel: string,
  config: Record<string, string> | null | undefined,
  payload: AlertNotifyPayload,
): Promise<void> {
  // Always emit via Socket.IO for UI
  try {
    getIO().emit("alert:fired", payload);
  } catch {
    // Socket not initialized
  }

  // Legacy direct dispatch as fallback
  if (channel === "slack" && config?.url) {
    await sendSlack(config.url, payload.message, payload.message).catch(
      () => {},
    );
  }
  if (channel === "webhook" && config?.url) {
    await sendWebhook(config.url, undefined, {
      event: "alert.fired",
      projectId: "",
      title: `Alert: ${payload.serviceName}`,
      message: payload.message,
      meta: payload as any,
    }).catch(() => {});
  }
}

async function dispatchToChannel(
  type: string,
  config: Record<string, string>,
  payload: NotificationPayload,
): Promise<void> {
  switch (type) {
    case "discord":
      return sendDiscord(config.webhookUrl!, payload);
    case "slack":
      return sendSlack(
        config.webhookUrl!,
        payload.title,
        payload.message,
        payload.meta,
      );
    case "telegram":
      return sendTelegram(config.botToken!, config.chatId!, payload);
    case "email":
      return sendEmail(config, payload);
    case "webhook":
      return sendWebhook(config.url!, config.secret, payload);
    default:
      console.warn(`[notifier] Unknown channel type: ${type}`);
  }
}

async function sendDiscord(
  webhookUrl: string,
  payload: NotificationPayload,
): Promise<void> {
  const color = getEventColor(payload.event);
  const emoji = getEventEmoji(payload.event);

  const embed = {
    title: `${emoji} ${payload.title}`,
    description: payload.message,
    color,
    fields: buildFields(payload.meta),
    timestamp: new Date().toISOString(),
    footer: { text: "DeployKit" },
  };

  await assertSafeUrl(webhookUrl);
  const res = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "DeployKit", embeds: [embed] }),
    signal: AbortSignal.timeout(10_000),
  });

  if (!res.ok) {
    throw new Error(`Discord HTTP ${res.status}: ${await res.text()}`);
  }
}

async function sendSlack(
  webhookUrl: string,
  title: string,
  message: string,
  meta?: Record<string, unknown>,
): Promise<void> {
  const emoji = meta?.error ? ":x:" : ":white_check_mark:";
  const blocks: any[] = [
    {
      type: "section",
      text: { type: "mrkdwn", text: `${emoji} *${title}*\n${message}` },
    },
  ];

  if (meta) {
    const elements = Object.entries(meta)
      .filter(([, v]) => v !== undefined && v !== null && v !== "")
      .slice(0, 8)
      .map(([k, v]) => ({ type: "mrkdwn", text: `*${k}:* ${String(v)}` }));
    if (elements.length > 0) blocks.push({ type: "context", elements });
  }

  await assertSafeUrl(webhookUrl);
  const res = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ blocks }),
    signal: AbortSignal.timeout(10_000),
  });

  if (!res.ok) throw new Error(`Slack HTTP ${res.status}`);
}

async function sendTelegram(
  botToken: string,
  chatId: string,
  payload: NotificationPayload,
): Promise<void> {
  const emoji = getEventEmoji(payload.event);
  let text = `${emoji} <b>${esc(payload.title)}</b>\n\n${esc(payload.message)}`;

  if (payload.meta) {
    const lines = Object.entries(payload.meta)
      .filter(([, v]) => v !== undefined && v !== null && v !== "")
      .slice(0, 8)
      .map(([k, v]) => `<b>${esc(k)}:</b> ${esc(String(v))}`);
    if (lines.length > 0) text += `\n\n${lines.join("\n")}`;
  }

  const res = await fetch(
    `https://api.telegram.org/bot${botToken}/sendMessage`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: "HTML",
        disable_web_page_preview: true,
      }),
      signal: AbortSignal.timeout(10_000),
    },
  );

  if (!res.ok)
    throw new Error(`Telegram HTTP ${res.status}: ${await res.text()}`);
}

async function sendEmail(
  config: Record<string, string>,
  payload: NotificationPayload,
): Promise<void> {
  const { to, resendApiKey, from } = config;
  if (!to || !resendApiKey)
    throw new Error("Email: to and resendApiKey required");

  const emoji = getEventEmoji(payload.event);
  const fromAddr = from || "DeployKit <notifications@deploykit.es>";

  let html = `<h2>${emoji} ${esc(payload.title)}</h2><p>${esc(payload.message)}</p>`;
  if (payload.meta) {
    html += `<table style="border-collapse:collapse;margin-top:16px;">`;
    for (const [k, v] of Object.entries(payload.meta)) {
      if (v === undefined || v === null || v === "") continue;
      html += `<tr><td style="padding:4px 12px 4px 0;font-weight:bold;color:#666;">${esc(k)}</td><td style="padding:4px 0;">${esc(String(v))}</td></tr>`;
    }
    html += `</table>`;
  }
  html += `<hr style="margin-top:24px;border:none;border-top:1px solid #eee;"><p style="color:#999;font-size:12px;">Sent by DeployKit</p>`;

  const recipients = to
    .split(",")
    .map((e) => e.trim())
    .filter(Boolean);

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${resendApiKey}`,
    },
    body: JSON.stringify({
      from: fromAddr,
      to: recipients,
      subject: `[DeployKit] ${payload.title}`,
      html,
    }),
    signal: AbortSignal.timeout(15_000),
  });

  if (!res.ok)
    throw new Error(`Resend HTTP ${res.status}: ${await res.text()}`);
}

async function sendWebhook(
  url: string,
  secret: string | undefined,
  payload: NotificationPayload,
): Promise<void> {
  const body = JSON.stringify({
    source: "deploykit",
    event: payload.event,
    timestamp: new Date().toISOString(),
    data: {
      title: payload.title,
      message: payload.message,
      projectId: payload.projectId,
      ...payload.meta,
    },
  });

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (secret) {
    headers["X-DeployKit-Signature"] =
      `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
  }

  await assertSafeUrl(url);
  const res = await fetch(url, {
    method: "POST",
    headers,
    body,
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`Webhook HTTP ${res.status}`);
}

export async function sendTestNotification(
  type: string,
  config: Record<string, string>,
): Promise<{ success: boolean; error?: string }> {
  const payload: NotificationPayload = {
    event: "deploy.success",
    projectId: "test",
    title: "Test Notification",
    message:
      "This is a test from DeployKit. If you see this, the channel works!",
    meta: {
      applicationName: "test-app",
      branch: "main",
      commitHash: "abc1234",
    },
  };

  try {
    await dispatchToChannel(type, config, payload);
    return { success: true };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

function getEventColor(event: string): number {
  if (event.includes("success") || event.includes("completed")) return 0x2ea043;
  if (event.includes("failed") || event.includes("error")) return 0xda3633;
  if (event.includes("stopped")) return 0xd29922;
  return 0x58a6ff;
}

function getEventEmoji(event: string): string {
  if (event.includes("success") || event.includes("completed")) return "✅";
  if (event.includes("failed") || event.includes("error")) return "❌";
  if (event.includes("stopped")) return "⚠️";
  if (event.includes("alert")) return "🔔";
  return "📋";
}

function buildFields(
  meta?: Record<string, unknown>,
): Array<{ name: string; value: string; inline: boolean }> {
  if (!meta) return [];
  return Object.entries(meta)
    .filter(([, v]) => v !== undefined && v !== null && v !== "")
    .slice(0, 10)
    .map(([k, v]) => ({
      name: k.replace(/([A-Z])/g, " $1").replace(/^./, (s) => s.toUpperCase()),
      value: String(v),
      inline: String(v).length < 30,
    }));
}

function esc(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
