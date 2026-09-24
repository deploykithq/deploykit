import { useState } from "react";

import { trpc } from "@lib/trpc";

/**
 * Registration and management of the instance's GitHub App.
 *
 * The manifest exchange is a browser form POST, not a fetch: GitHub only
 * accepts the manifest as a form field, and it answers with a redirect.
 */
export const useGitHubApp = () => {
  const utils = trpc.useUtils();

  const status = trpc.github.status.useQuery();

  const [organization, setOrganization] = useState<string>("");
  const [appName, setAppName] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const flash = (message: string) => {
    setNotice(message);
    setTimeout(() => setNotice(null), 3000);
  };

  const startManifest = trpc.github.startManifest.useMutation({
    onError: (err) => setError(err.message),
    onSuccess: ({ postUrl, manifest }) => {
      // GitHub requires a real form submission with the manifest as a field.
      const form = document.createElement("form");
      form.method = "POST";
      form.action = postUrl;

      const field = document.createElement("input");
      field.type = "hidden";
      field.name = "manifest";
      field.value = manifest;

      form.appendChild(field);
      document.body.appendChild(form);
      form.submit();
    },
  });

  const connectExisting = trpc.github.connectExisting.useMutation({
    onError: (err) => setError(err.message),
    onSuccess: () => {
      utils.github.status.invalidate();
      flash("Connected");
    },
  });

  const test = trpc.github.test.useMutation({
    onError: (err) => setError(err.message),
    onSuccess: (res) => flash(`Connected as ${res.name}`),
  });

  const syncInstallations = trpc.github.syncInstallations.useMutation({
    onError: (err) => setError(err.message),
    onSuccess: (res) => {
      utils.github.status.invalidate();
      flash(
        `${res.found} installation(s) found` +
          (res.removed > 0 ? `, ${res.removed} removed` : ""),
      );
    },
  });

  const disconnect = trpc.github.disconnect.useMutation({
    onError: (err) => setError(err.message),
    onSuccess: () => {
      utils.github.status.invalidate();
      flash("Disconnected");
    },
  });

  const register = () => {
    setError(null);
    startManifest.mutate({
      organization: organization.trim() || undefined,
      name: appName.trim() || undefined,
    });
  };

  return {
    status: status.data,
    loading: status.isLoading,
    organization,
    setOrganization,
    appName,
    setAppName,
    register,
    registering: startManifest.isPending,
    connectExisting,
    test,
    syncInstallations,
    disconnect,
    error,
    setError,
    notice,
  };
};
