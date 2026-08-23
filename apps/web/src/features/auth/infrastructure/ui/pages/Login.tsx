import { useLoginForm } from "@auth/infrastructure/ui/hooks/useLoginForm";

import { Button } from "@shared/components/button";
import { Input } from "@shared/components/input";
import { AppLogo, ErrorMessage } from "@auth/infrastructure/ui/components";

import { COPY } from "@auth/infrastructure/ui/constants/auth.constants";

export const LoginPage: React.FC = () => {
  const {
    email,
    setEmail,
    password,
    setPassword,
    error,
    isRegister,
    isPending,
    hasUsers,
    handleSubmit,
  } = useLoginForm();

  const copy = isRegister ? COPY.register : COPY.login;

  return (
    <div className="min-h-screen flex items-center justify-center bg-surface-0">
      <div className="w-full max-w-sm">
        <AppLogo />

        <div className="bg-surface-1 border border-border rounded-2xl p-6">
          <h2 className="text-lg font-semibold mb-1">{copy.title}</h2>
          <p className="text-sm text-text-secondary mb-6">{copy.subtitle}</p>

          <form onSubmit={handleSubmit} className="space-y-4">
            <Input
              label="Email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="admin@example.com"
              required
            />
            <Input
              label="Password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              required
              minLength={8}
            />

            <ErrorMessage message={error} />

            <Button type="submit" className="w-full" disabled={isPending}>
              {isPending ? "Loading..." : copy.submit}
            </Button>
          </form>

          {hasUsers === false && (
            <p className="mt-4 text-xs text-text-muted text-center">
              {COPY.register.hint}
            </p>
          )}
        </div>
      </div>
    </div>
  );
};
