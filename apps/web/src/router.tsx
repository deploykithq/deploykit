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
      throw redirect({ to: "/login", search: { redirect: location.pathname } });
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
