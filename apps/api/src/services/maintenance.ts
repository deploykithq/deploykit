/**
 * Maintenance mode for applications.
 *
 * Traefik only reads Docker labels here, and a label cannot change on a
 * running container, so maintenance never touches the app itself. Enabling it
 * starts a small `dk-maint-<appId>` nginx container carrying routers for the
 * same domains at a much higher priority; it answers every request with a 503
 * page. Disabling it removes that container and Traefik routes to the app
 * again at once — no redeploy, and a deploy in between leaves it in place.
 *
 * The container deliberately never carries `deploykit.service`: that label is
 * how replicas are listed, scaled, scraped and removed, and this is not one.
 * It publishes no ports and keeps `unless-stopped` so a host reboot does not
 * silently reopen an app that is meant to be closed.
 */
import { getDockerForServer } from "./docker-factory";
import { buildTraefikLabels } from "../lib/traefik";

const MAINTENANCE_IMAGE = "nginx:alpine";
const MAINTENANCE_PRIORITY = 10_000;

interface MaintenanceAppI {
  id: string;
  name: string;
  serverId: string | null;
  maintenanceMessage: string | null;
}

interface MaintenanceDomainI {
  domain: string;
  https: boolean;
  certificateResolver?: string | null;
}

const maintenanceContainerName = (appId: string): string => `dk-maint-${appId}`;

const escapeHtml = (value: string): string =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

/**
 * The visitor-facing page. Self-contained on purpose — no fonts, scripts or
 * images from elsewhere — because it is served while the app is down and must
 * not depend on anything else being up.
 *
 * The default copy follows the visitor's browser language (English/Spanish);
 * the operator's message is shown as written. While open, the page polls its
 * own URL and reloads as soon as the answer is no longer a 503, so a visitor
 * who waits lands back on the app without doing anything.
 */
const renderMaintenancePage = (
  appName: string,
  message?: string | null,
  since: Date = new Date(),
): string => {
  const name = escapeHtml(appName);
  const initial = escapeHtml((appName.trim()[0] ?? "•").toUpperCase());
  const custom = message?.trim()
    ? escapeHtml(message.trim()).replace(/\r?\n/g, "<br>")
    : "";
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<meta name="color-scheme" content="light dark">
<title>${name} · Under maintenance</title>
<noscript><meta http-equiv="refresh" content="120"></noscript>
<style>
:root{--bg:#f6f7f9;--surface:#ffffff;--text:#0f172a;--muted:#475569;--subtle:#94a3b8;--border:#e2e8f0;--accent:#d97706;--accent-soft:rgba(217,119,6,.12);--grid:rgba(15,23,42,.045)}
@media (prefers-color-scheme:dark){:root{--bg:#0a0c10;--surface:#11151c;--text:#f1f5f9;--muted:#a3adbd;--subtle:#64748b;--border:#1f2733;--accent:#f59e0b;--accent-soft:rgba(245,158,11,.14);--grid:rgba(255,255,255,.035)}}
*{box-sizing:border-box}
html,body{height:100%}
body{margin:0;display:flex;flex-direction:column;min-height:100vh;background:var(--bg);color:var(--text);font:16px/1.6 ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif;-webkit-font-smoothing:antialiased;
background-image:radial-gradient(ellipse 60% 50% at 50% -10%,var(--accent-soft),transparent 70%),linear-gradient(var(--grid) 1px,transparent 1px),linear-gradient(90deg,var(--grid) 1px,transparent 1px);background-size:auto,40px 40px,40px 40px}
header{padding:24px 24px 0;display:flex;align-items:center;gap:10px;max-width:1080px;width:100%;margin:0 auto}
.mark{width:32px;height:32px;border-radius:9px;display:grid;place-items:center;background:var(--text);color:var(--bg);font-weight:700;font-size:15px}
.brand{font-weight:600;font-size:15px;letter-spacing:-.01em;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
main{flex:1;display:flex;align-items:center;justify-content:center;padding:32px 16px}
.card{width:100%;max-width:560px;background:var(--surface);border:1px solid var(--border);border-radius:20px;padding:44px 40px 36px;box-shadow:0 1px 2px rgba(15,23,42,.04),0 12px 40px -12px rgba(15,23,42,.12)}
.status{display:inline-flex;align-items:center;gap:8px;padding:5px 12px 5px 10px;border-radius:999px;background:var(--accent-soft);color:var(--accent);font-size:13px;font-weight:600}
.dot{position:relative;width:8px;height:8px;border-radius:50%;background:currentColor}
.dot::after{content:"";position:absolute;inset:0;border-radius:50%;background:currentColor;animation:ping 1.8s cubic-bezier(0,0,.2,1) infinite}
@keyframes ping{75%,100%{transform:scale(2.4);opacity:0}}
h1{margin:22px 0 12px;font-size:clamp(1.75rem,4.5vw,2.25rem);line-height:1.15;letter-spacing:-.025em;font-weight:700}
.lead{margin:0;color:var(--muted);font-size:1.0625rem;overflow-wrap:anywhere}
.note{margin:16px 0 0;padding:14px 16px;border-left:3px solid var(--accent);background:var(--accent-soft);border-radius:0 10px 10px 0;color:var(--text);font-size:.975rem;overflow-wrap:anywhere}
.progress{margin:32px 0 14px;height:4px;border-radius:999px;background:var(--border);overflow:hidden}
.progress span{display:block;width:35%;height:100%;border-radius:inherit;background:var(--accent);animation:slide 1.6s ease-in-out infinite}
@keyframes slide{0%{transform:translateX(-100%)}100%{transform:translateX(290%)}}
.meta{display:flex;flex-wrap:wrap;justify-content:space-between;gap:6px 16px;font-size:13px;color:var(--subtle)}
footer{padding:0 24px 24px;text-align:center;font-size:12px;color:var(--subtle);font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}
@media (max-width:480px){.card{padding:32px 22px 28px;border-radius:16px}}
@media (prefers-reduced-motion:reduce){.dot::after,.progress span{animation:none}.progress span{width:100%;opacity:.35}}
</style>
</head>
<body>
<header><div class="mark" aria-hidden="true">${initial}</div><div class="brand">${name}</div></header>
<main>
<section class="card" role="status" aria-live="polite">
<div class="status"><span class="dot" aria-hidden="true"></span><span data-i18n="badge">Scheduled maintenance</span></div>
<h1 data-i18n="title">We&rsquo;ll be back soon</h1>
<p class="lead" data-i18n="lead">We&rsquo;re carrying out planned maintenance to improve the service. Thanks for your patience.</p>
${custom ? `<p class="note">${custom}</p>` : ""}
<div class="progress" aria-hidden="true"><span></span></div>
<div class="meta"><span data-i18n="auto">This page will reload automatically when we&rsquo;re back.</span><span id="since" data-since="${since.toISOString()}"></span></div>
</section>
</main>
<footer>503 · <span data-i18n="code">Service temporarily unavailable</span></footer>
<script>
(function(){
  var T={
    es:{badge:"Mantenimiento programado",title:"Volveremos en breve",lead:"Estamos realizando tareas de mantenimiento para mejorar el servicio. Gracias por tu paciencia.",auto:"Esta página se recargará automáticamente cuando volvamos.",code:"Servicio no disponible temporalmente",since:"Desde el ",doc:"En mantenimiento"},
    en:{since:"Since ",doc:"Under maintenance"}
  };
  var lang=(navigator.language||"en").slice(0,2).toLowerCase()==="es"?"es":"en";
  var t=T[lang];
  document.documentElement.lang=lang;
  document.querySelectorAll("[data-i18n]").forEach(function(el){var v=t[el.getAttribute("data-i18n")];if(v)el.textContent=v;});
  document.title=document.title.split(" · ")[0]+" · "+t.doc;
  var s=document.getElementById("since");
  try{s.textContent=t.since+new Date(s.getAttribute("data-since")).toLocaleString(lang,{hour:"2-digit",minute:"2-digit",day:"numeric",month:"short"});}catch(e){}
  function check(){fetch(location.href,{method:"HEAD",cache:"no-store"}).then(function(r){if(r.status!==503)location.reload();}).catch(function(){});}
  setInterval(check,30000);
})();
</script>
</body>
</html>
`;
};

/**
 * Every path — the page's own file included — answers 503 with the page, so
 * no URL returns a 200 that a cache or uptime checker would take as "up".
 */
const NGINX_CONF = `server {
  listen 80 default_server;
  root /usr/share/nginx/html;
  add_header Retry-After 300 always;
  add_header Cache-Control "no-store" always;
  error_page 503 @maintenance;
  location @maintenance { rewrite ^ /maintenance.html break; }
  location / { return 503; }
}
`;

const toB64 = (value: string): string =>
  Buffer.from(value, "utf8").toString("base64");

/**
 * Both files travel base64-encoded in the environment so no quoting survives
 * into `sh -c` — remote servers pass env through `docker run -e` over SSH.
 */
const START_SCRIPT = [
  'echo "$DK_MAINT_HTML_B64" | base64 -d > /usr/share/nginx/html/maintenance.html',
  'echo "$DK_MAINT_CONF_B64" | base64 -d > /etc/nginx/conf.d/default.conf',
  'exec nginx -g "daemon off;"',
].join(" && ");

/** Start (or replace) the maintenance container for `app`'s domains. */
const enableMaintenance = async (
  app: MaintenanceAppI,
  domains: MaintenanceDomainI[],
): Promise<void> => {
  if (domains.length === 0) {
    throw new Error("The application has no domains to put in maintenance");
  }
  const name = maintenanceContainerName(app.id);
  const labels = {
    ...buildTraefikLabels(
      name,
      domains.map((d) => ({
        domain: d.domain,
        https: d.https,
        certificateResolver: d.certificateResolver,
        port: 80,
      })),
      { priority: MAINTENANCE_PRIORITY },
    ),
    "deploykit.managed": "true",
    "deploykit.maintenance": app.id,
  };

  const { docker } = await getDockerForServer(app.serverId);
  // createAndStart removes a container of the same name first, so enabling
  // again (new message, changed domains) is an in-place replace.
  await docker.createAndStart({
    name,
    image: MAINTENANCE_IMAGE,
    env: [
      `DK_MAINT_HTML_B64=${toB64(renderMaintenancePage(app.name, app.maintenanceMessage))}`,
      `DK_MAINT_CONF_B64=${toB64(NGINX_CONF)}`,
    ],
    command: ["sh", "-c", START_SCRIPT],
    labels,
    networkName: "deploykit-network",
  });
};

/** Remove the maintenance container; a missing one is not an error. */
const disableMaintenance = async (
  app: Pick<MaintenanceAppI, "id" | "serverId">,
): Promise<void> => {
  const { docker } = await getDockerForServer(app.serverId);
  await docker
    .stopAndRemove(maintenanceContainerName(app.id))
    .catch((err: unknown) => {
      if (!/no such container|404/i.test(String((err as Error)?.message ?? err)))
        throw err;
    });
};

/**
 * Re-apply maintenance after the app's domains changed, so a domain added
 * while the app is closed is closed too. With no domain left there is nothing
 * to route, and the container is removed.
 */
const syncMaintenance = async (
  app: MaintenanceAppI & { maintenanceEnabled: boolean },
  domains: MaintenanceDomainI[],
): Promise<void> => {
  if (!app.maintenanceEnabled) return;
  if (domains.length === 0) await disableMaintenance(app);
  else await enableMaintenance(app, domains);
};

export {
  enableMaintenance,
  disableMaintenance,
  syncMaintenance,
  renderMaintenancePage,
  maintenanceContainerName,
  NGINX_CONF,
  START_SCRIPT,
};
