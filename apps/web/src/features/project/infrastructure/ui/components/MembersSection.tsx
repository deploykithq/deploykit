import { memo } from "react";
import { Plus, Shield, Users } from "lucide-react";

import { Button } from "@shared/components/button";
import { Card } from "@shared/components/card";
import { EmptyState } from "@shared/components/empty-state";

import {
  AddMemberModal,
  MemberCard,
} from "@project/infrastructure/ui/components";

import { useProjectMembers } from "@project/infrastructure/ui/hooks/useProjectMembers";

interface MembersSectionPropsI {
  projectId: string;
}

export const MembersSection: React.FC<MembersSectionPropsI> = memo(
  function MembersSection({ projectId }) {
    const { showModal, setShowModal, members, isLoading, canManage } =
      useProjectMembers(projectId);

    return (
      <section>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-xs font-medium text-text-muted uppercase tracking-wider">
            Members
          </h2>
          {canManage && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setShowModal(true)}
            >
              <Plus className="w-3.5 h-3.5" />
              Add Member
            </Button>
          )}
        </div>

        {isLoading ? (
          <p className="text-xs text-text-muted">Loading…</p>
        ) : members.length === 0 ? (
          <Card>
            <EmptyState
              icon={<Users className="w-6 h-6" />}
              title="No project-specific members"
              description="All users use their global role for this project. Add members to assign project-specific roles."
              action={
                canManage ? (
                  <Button size="sm" onClick={() => setShowModal(true)}>
                    <Plus className="w-3.5 h-3.5" />
                    Add Member
                  </Button>
                ) : undefined
              }
            />
          </Card>
        ) : (
          <Card>
            {/* Header hint */}
            <div className="flex items-center gap-2 mb-2 pb-2 border-b border-border">
              <Shield className="w-3 h-3 text-text-muted" />
              <span className="text-[11px] text-text-muted">
                These roles override global roles for this project only
              </span>
            </div>
            {members.map((member) => (
              <MemberCard
                key={member.id}
                member={member}
                projectId={projectId}
                canManage={canManage}
              />
            ))}
          </Card>
        )}

        <AddMemberModal
          open={showModal}
          onClose={() => setShowModal(false)}
          projectId={projectId}
        />
      </section>
    );
  },
);
