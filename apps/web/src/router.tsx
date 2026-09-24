import { lazy, Suspense } from "react";
import {
  createRouter,
  createRoute,
  createRootRoute,
  Outlet,
  redirect,
} from "@tanstack/react-router";

import { useAuthStore } from "@lib/auth";

import { LoginPage } from "@auth/infrastructure/ui/pages/Login";
import { AppLayout } from "@layout/infrastructure/ui/pages/AppLayout";

const DashboardPage = lazy(() =>
  import("@dashboard/infrastructure/ui/pages/Dashboard").then((m) => ({
    default: m.DashboardPage,
  })),
);
const ServersPage = lazy(() =>
  import("@server/infrastructure/ui/pages/Servers").then((m) => ({
    default: m.ServersPage,
  })),
);
const SshKeysPage = lazy(() =>
  import("@ssh-keys/infrastructure/ui/pages/SshKeys").then((m) => ({
    default: m.SshKeysPage,
  })),
);
const UsersPage = lazy(() =>
  import("@users/infrastructure/ui/pages/Users").then((m) => ({
    default: m.UsersPage,
  })),
);
const SettingsPage = lazy(() =>
  import("@settings/infrastructure/ui/pages/Settings").then((m) => ({
    default: m.SettingsPage,
  })),
);
const GitHubAppPage = lazy(() =>
  import("@github/infrastructure/ui/pages/GitHubApp").then((m) => ({
    default: m.GitHubAppPage,
  })),
);
const GitHubCallbackPage = lazy(() =>
  import("@github/infrastructure/ui/pages/GitHubCallback").then((m) => ({
    default: m.GitHubCallbackPage,
  })),
);
const AuditLogPage = lazy(() =>
  import("@audit/infrastructure/ui/pages/AuditLog").then((m) => ({
    default: m.AuditLogPage,
  })),
);
const AlertsPage = lazy(() =>
  import("@metrics/infrastructure/ui/pages/Alerts").then((m) => ({
    default: m.AlertsPage,
  })),
);
const TemplatesPage = lazy(() =>
  import("@templates/infrastructure/ui/pages/Templates").then((m) => ({
    default: m.TemplatesPage,
  })),
);
const ProjectDetailPage = lazy(() =>
  import("@project/infrastructure/ui/pages/ProjectDetail").then((m) => ({
    default: m.ProjectDetailPage,
  })),
);
const DatabaseDetailPage = lazy(() =>
  import("@database/infrastructure/ui/pages/DatabaseDetail").then((m) => ({
    default: m.DatabaseDetailPage,
  })),
);
const ApplicationDetailPage = lazy(() =>
  import("@application/infrastructure/ui/pages/ApplicationDetailPage").then(
    (m) => ({ default: m.ApplicationDetailPage }),
  ),
);
const ComposeDetailPage = lazy(() =>
  import("@compose/infrastructure/ui/pages/ComposeDetailPage").then((m) => ({
    default: m.ComposeDetailPage,
  })),
);
const StatusPage = lazy(() =>
  import("@status/infrastructure/ui/pages/StatusPage").then((m) => ({
    default: m.StatusPage,
  })),
);

const PageFallback = () => (
  <div className="text-sm text-text-muted p-6">Loading...</div>
);

function withSuspense<T extends object>(Component: React.ComponentType<T>) {
  return function SuspensePage(props: T) {
    return (
      <Suspense fallback={<PageFallback />}>
        <Component {...props} />
      </Suspense>
    );
  };
}

export const rootRoute = createRootRoute({ component: Outlet });

export const loginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/login",
  component: LoginPage,
  validateSearch: (search: Record<string, unknown>): { redirect?: string } => {
    const raw = typeof search.redirect === "string" ? search.redirect : "";
    // Same-origin only: a path starting with a single slash. "//evil.com" and
    // "https://evil.com" would both be open redirects after sign-in.
    const safe = /^\/(?!\/)/.test(raw) ? raw : undefined;
    return { redirect: safe };
  },
  beforeLoad: () => {
    if (useAuthStore.getState().isAuthenticated()) {
      throw redirect({ to: "/" });
    }
  },
});


// Public, unauthenticated status page. Lives under the root route (not the
// auth layout) so visitors without a session can reach it.
export const statusPageRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/status/$slug",
  component: withSuspense(StatusPage),
});

// Pathless layout route — wraps all protected pages.
// Children inherit the guard without any URL segment.
export const authLayoutRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: "auth",
  component: AppLayout,
  beforeLoad: ({ location }) => {
    if (!useAuthStore.getState().isAuthenticated()) {
      // href, not pathname: an OAuth-style callback carries its parameters in
      // the query string, and dropping them would strand the flow.
      throw redirect({ to: "/login", search: { redirect: location.href } });
    }
  },
});

export const dashboardRoute = createRoute({
  getParentRoute: () => authLayoutRoute,
  path: "/",
  component: withSuspense(DashboardPage),
});

export const projectsIndexRoute = createRoute({
  getParentRoute: () => authLayoutRoute,
  path: "/projects",
  component: withSuspense(DashboardPage),
});

export const serversRoute = createRoute({
  getParentRoute: () => authLayoutRoute,
  path: "/servers",
  component: withSuspense(ServersPage),
});

export const sshKeysRoute = createRoute({
  getParentRoute: () => authLayoutRoute,
  path: "/ssh-keys",
  component: withSuspense(SshKeysPage),
});

export const usersRoute = createRoute({
  getParentRoute: () => authLayoutRoute,
  path: "/users",
  component: withSuspense(UsersPage),
});

export const settingsRoute = createRoute({
  getParentRoute: () => authLayoutRoute,
  path: "/settings",
  component: withSuspense(SettingsPage),
});

export const githubAppRoute = createRoute({
  getParentRoute: () => authLayoutRoute,
  path: "/settings/github",
  component: withSuspense(GitHubAppPage),
});

/**
 * Where GitHub redirects back to after creating or installing the App.
 *
 * Under the auth layout because it calls admin-only procedures, and the
 * one-time state is bound to the admin who started the flow.
 */
export const githubCallbackRoute = createRoute({
  getParentRoute: () => authLayoutRoute,
  path: "/settings/github/callback",
  validateSearch: (
    search: Record<string, unknown>,
  ): {
    code?: string;
    state?: string;
    installation_id?: string;
    setup_action?: string;
  } => ({
    code: typeof search.code === "string" ? search.code : undefined,
    state: typeof search.state === "string" ? search.state : undefined,
    installation_id:
      search.installation_id === undefined
        ? undefined
        : String(search.installation_id),
    setup_action:
      typeof search.setup_action === "string" ? search.setup_action : undefined,
  }),
  component: withSuspense(GitHubCallbackPage),
});

export const auditLogRoute = createRoute({
  getParentRoute: () => authLayoutRoute,
  path: "/audit-log",
  component: withSuspense(AuditLogPage),
});

export const alertsRoute = createRoute({
  getParentRoute: () => authLayoutRoute,
  path: "/alerts",
  component: withSuspense(AlertsPage),
});

export const templatesRoute = createRoute({
  getParentRoute: () => authLayoutRoute,
  path: "/templates",
  component: withSuspense(TemplatesPage),
});

export const projectDetailRoute = createRoute({
  getParentRoute: () => authLayoutRoute,
  path: "/projects/$projectId",
  component: withSuspense(ProjectDetailPage),
});

export const appDetailRoute = createRoute({
  getParentRoute: () => authLayoutRoute,
  path: "/projects/$projectId/apps/$appId",
  component: withSuspense(ApplicationDetailPage),
});

export const composeDetailRoute = createRoute({
  getParentRoute: () => authLayoutRoute,
  path: "/projects/$projectId/compose/$composeId",
  component: withSuspense(ComposeDetailPage),
});

export const dbDetailRoute = createRoute({
  getParentRoute: () => authLayoutRoute,
  path: "/projects/$projectId/db/$dbId",
  component: withSuspense(DatabaseDetailPage),
});

const routeTree = rootRoute.addChildren([
  loginRoute,
  statusPageRoute,
  authLayoutRoute.addChildren([
    dashboardRoute,
    projectsIndexRoute,
    projectDetailRoute,
    appDetailRoute,
    composeDetailRoute,
    dbDetailRoute,
    serversRoute,
    sshKeysRoute,
    usersRoute,
    settingsRoute,
    githubAppRoute,
    githubCallbackRoute,
    auditLogRoute,
    alertsRoute,
    templatesRoute,
  ]),
]);

export const router = createRouter({ routeTree });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
