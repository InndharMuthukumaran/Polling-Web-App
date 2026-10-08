import React, { useState } from 'react';
import type { JoinMember } from '../api/types';
import { Button } from './Button';
import { Banner } from './Banner';

export interface NameClaimListProps {
  members: JoinMember[];
  onClaim: (memberId: string) => Promise<void>;
  isClaiming?: boolean;
  error?: string | null;
  className?: string;
  selectedId?: string | null;
  onSelectId?: (id: string | null) => void;
}

export const NameClaimList: React.FC<NameClaimListProps> = ({
  members,
  onClaim,
  isClaiming = false,
  error = null,
  className = '',
  selectedId: controlledSelectedId,
  onSelectId,
}) => {
  const [internalSelectedId, setInternalSelectedId] = useState<string | null>(null);

  const selectedId = controlledSelectedId !== undefined ? controlledSelectedId : internalSelectedId;
  const setSelectedId = (id: string | null) => {
    if (onSelectId) onSelectId(id);
    setInternalSelectedId(id);
  };

  // If selected member is taken after reload, or missing, clear selection
  React.useEffect(() => {
    if (selectedId) {
      const current = members.find((m) => m.id === selectedId);
      if (!current || current.taken) {
        setSelectedId(null);
      }
    }
  }, [members, selectedId]);

  // If conflict error occurs, clear selection
  React.useEffect(() => {
    if (error && error.includes('was just taken by someone else')) {
      setSelectedId(null);
    }
  }, [error]);

  const selectedMember = members.find((m) => m.id === selectedId);

  const handleConfirm = async () => {
    if (!selectedId) return;
    await onClaim(selectedId);
  };


  return (
    <div className={`space-y-4 ${className}`.trim()}>
      <div className="space-y-1">
        <h2 className="text-lg font-bold text-neutral-900">Choose your name</h2>
        <p className="text-sm text-neutral-600">
          Pick your name from the group roster to identify your device.
        </p>
      </div>

      {error && (
        <Banner type="error" title="Could not claim name">
          {error}
        </Banner>
      )}

      {selectedMember && (
        <div className="p-4 bg-indigo-50/80 border border-indigo-200 rounded-2xl space-y-3 animate-in fade-in duration-150">
          <div className="text-sm text-indigo-950">
            <span className="text-neutral-600">This is me: </span>
            <span className="font-bold text-base text-indigo-900">{selectedMember.display_name}</span>
          </div>
          <div className="flex gap-2">
            <Button
              variant="primary"
              size="md"
              fullWidth
              loading={isClaiming}
              onClick={handleConfirm}
            >
              Confirm
            </Button>
            <Button
              variant="secondary"
              size="md"
              disabled={isClaiming}
              onClick={() => setSelectedId(null)}
            >
              Change
            </Button>
          </div>
        </div>
      )}

      <div className="space-y-2">
        {members.length === 0 ? (
          <p className="text-sm text-neutral-500 py-4 text-center">
            No members have been added to this group yet.
          </p>
        ) : (
          members.map((member) => {
            const isSelected = member.id === selectedId;

            if (member.taken) {
              return (
                <button
                  key={member.id}
                  type="button"
                  disabled
                  className="w-full text-left p-3.5 rounded-xl border border-neutral-200 bg-neutral-50/80 opacity-60 cursor-not-allowed min-h-[44px]"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-neutral-500 line-through">
                        {member.display_name}
                      </span>
                      {member.identifier_hint && (
                        <span className="text-xs text-neutral-400 font-normal">
                          {member.identifier_hint}
                        </span>
                      )}
                    </div>
                    <span className="text-xs text-neutral-500 font-medium">Taken</span>
                  </div>
                  <p className="text-xs text-neutral-500 mt-1">
                    Already taken. If that is you on a new phone, ask the group creator to reset it.
                  </p>
                </button>
              );
            }

            return (
              <button
                key={member.id}
                type="button"
                disabled={isClaiming}
                onClick={() => setSelectedId(member.id)}
                className={`w-full text-left px-4 py-3.5 rounded-xl border transition-all duration-150 min-h-[44px] flex items-center justify-between cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-600 focus-visible:ring-offset-2 ${
                  isSelected
                    ? 'border-indigo-600 bg-indigo-50/50 shadow-sm ring-1 ring-indigo-600 font-semibold text-indigo-950'
                    : 'border-neutral-200 bg-white hover:border-neutral-300 hover:bg-neutral-50 text-neutral-900 font-medium'
                }`}
              >
                <div className="flex items-center gap-2">
                  <span>{member.display_name}</span>
                  {member.identifier_hint && (
                    <span className="text-xs text-neutral-400 font-normal">
                      {member.identifier_hint}
                    </span>
                  )}
                </div>
                <span
                  className={`w-5 h-5 rounded-full border flex items-center justify-center transition-colors ${
                    isSelected
                      ? 'border-indigo-600 bg-indigo-600 text-white'
                      : 'border-neutral-300'
                  }`}
                  aria-hidden="true"
                >
                  {isSelected && (
                    <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                    </svg>
                  )}
                </span>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
};
