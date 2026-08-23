import { User } from "lucide-react";

import { useProfileForm } from "@settings/infrastructure/ui/hooks/useProfileForm";

import { Button } from "@shared/components/button";
import { FormStatus } from "@shared/components/form-status";
import { Input } from "@shared/components/input";
import { SectionCard, RoleBadge } from "@settings/infrastructure/ui/components";

export const ProfileSection: React.FC = () => {
  const {
    user,
    email,
    setEmail,
    success,
    isPending,
    error,
    hasChanges,
    handleSubmit,
  } = useProfileForm();

  return (
    <SectionCard icon={User} title="Profile">
      <form onSubmit={handleSubmit} className="space-y-4">
        <Input
          label="Email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
        <div className="flex items-center gap-3">
          <Button type="submit" size="sm" disabled={isPending || !hasChanges}>
            {isPending ? "Saving..." : "Update Email"}
          </Button>
          <FormStatus
            success={success}
            successMessage="Updated"
            error={error}
          />
        </div>
      </form>

      {user?.role && (
        <div className="mt-4 pt-4 border-t border-border">
          <RoleBadge role={user.role} />
        </div>
      )}
    </SectionCard>
  );
};
