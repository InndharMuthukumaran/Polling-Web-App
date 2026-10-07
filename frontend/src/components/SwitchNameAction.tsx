import React, { useState } from 'react';
import { releaseClaim } from '../api/endpoints';
import { ApiError, getFriendlyErrorMessage } from '../api/client';
import { clearMemberIdentity } from '../lib/storage';
import { Button } from './Button';

export interface SwitchNameActionProps {
  displayName: string;
  memberToken: string;
  joinCode: string;
  onReleased: () => void | Promise<void>;
  className?: string;
}

export const SwitchNameAction: React.FC<SwitchNameActionProps> = ({
  displayName,
  memberToken,
  joinCode,
  onReleased,
  className = '',
}) => {
  const [showConfirm, setShowConfirm] = useState(false);
  const [isReleasing, setIsReleasing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleConfirm = async () => {
    setIsReleasing(true);
    setError(null);

    try {
      await releaseClaim(memberToken);
      clearMemberIdentity(joinCode);
      setShowConfirm(false);
      await onReleased();
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        // Creator already reset it: clear local identity and continue same way
        clearMemberIdentity(joinCode);
        setShowConfirm(false);
        await onReleased();
      } else {
        // Other error (e.g. network error): show error and keep identity
        setError(getFriendlyErrorMessage(err));
      }
    } finally {
      setIsReleasing(false);
    }
  };

  const handleCancel = () => {
    setShowConfirm(false);
    setError(null);
  };

  return (
    <div className={`inline-block ${showConfirm ? 'w-full max-[480px]:w-full' : ''} ${className}`.trim()}>
      {!showConfirm ? (
        <button
          type="button"
          onClick={() => {
            setError(null);
            setShowConfirm(true);
          }}
          className="text-xs text-indigo-600 hover:text-indigo-800 underline font-medium cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-600 rounded px-1 min-h-[32px] inline-flex items-center"
        >
          Not you? Switch name
        </button>
      ) : (
        <div className="mt-2 p-3 bg-amber-50 border border-amber-200 rounded-xl space-y-2 text-xs text-amber-950 text-left">
          <p className="leading-relaxed">
            This frees the name {displayName} so you or someone else can claim it again. Votes already made stay with that name.
          </p>

          {error && (
            <p className="text-rose-600 font-semibold" role="alert">
              {error}
            </p>
          )}

          <div className="flex items-center gap-2 pt-1">
            <Button
              size="sm"
              variant="danger"
              loading={isReleasing}
              onClick={handleConfirm}
            >
              Confirm switch
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={isReleasing}
              onClick={handleCancel}
            >
              Cancel
            </Button>
          </div>
        </div>
      )}
    </div>
  );
};
