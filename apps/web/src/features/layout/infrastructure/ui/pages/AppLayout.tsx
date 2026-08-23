import { Outlet } from "@tanstack/react-router";

import { Layout } from "@layout/infrastructure/ui/components";
import { AlertToasts } from "@metrics/infrastructure/ui/components/AlertToasts";

import { useAppLayout } from "@layout/infrastructure/ui/hooks/useAppLayout";

export const AppLayout: React.FC = () => {
  useAppLayout();

  return (
    <Layout>
      <Outlet />
      <AlertToasts />
    </Layout>
  );
};
