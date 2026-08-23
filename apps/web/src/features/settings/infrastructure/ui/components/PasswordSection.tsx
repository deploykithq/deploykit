import { Lock } from "lucide-react";

import { Button } from "@shared/components/button";
import { FormStatus } from "@shared/components/form-status";
import { Input } from "@shared/components/input";

import { SectionCard } from "@settings/infrastructure/ui/components";

import { usePasswordForm } from "@settings/infrastructure/ui/hooks/usePasswordForm";

export const PasswordSection: React.FC = () => {
  const {
    currentPassword,
    setCurrentPassword,
    newPassword,
    setNewPassword,
    confirmPassword,
    setConfirmPassword,
    success,
    isPending,
    error,
    canSubmit,
    handleSubmit,
  } = usePasswordForm();

  return (
    <SectionCard icon={Lock} title="Change Password">
      <form onSubmit={handleSubmit} className="space-y-4">
        <Input
          label="Current Password"
          type="password"
          value={currentPassword}
          onChange={(e) => setCurrentPassword(e.target.value)}
          required
        />
        <Input
          label="New Password"
          type="password"
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
          placeholder="Minimum 8 characters"
          required
        />
        <Input
          label="Confirm New Password"
          type="password"
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
          required
        />
        <div className="flex items-center gap-3">
          <Button type="submit" size="sm" disabled={!canSubmit}>
            {isPending ? "Changing..." : "Change Password"}
          </Button>
          <FormStatus
            success={success}
            successMessage="Password changed"
            error={error}
          />
        </div>
      </form>
    </SectionCard>
  );
}