import React, { useState } from 'react';
import type { JoinMember } from '../api/types';
import { lookupIdentifier } from '../api/endpoints';
import { ApiError, getFriendlyErrorMessage } from '../api/client';
import { getMemberIdentity } from '../lib/storage';
import { Button } from './Button';
import { Banner } from './Banner';
import { NameClaimList } from './NameClaimList';

export interface IdentifierClaimProps {
  joinCode: string;
  claimMode?: 'list' | 'identifier';
  identifierLabel?: string | null;
  allowNameList?: boolean;
  members: JoinMember[];
  selectedId?: string | null;
  onSelectId?: (id: string | null) => void;
  onClaim: (memberId: string, displayNameHint?: string) => Promise<void>;
  isClaiming?: boolean;
  error?: string | null;
  className?: string;
}

export const IdentifierClaim: React.FC<IdentifierClaimProps> = ({
  joinCode,
  claimMode = 'list',
  identifierLabel,
  allowNameList = false,
  members,
  selectedId,
  onSelectId,
  onClaim,
  isClaiming = false,
  error = null,
  className = '',
}) => {
  const [identifierInput, setIdentifierInput] = useState<string>('');
  const [isSearching, setIsSearching] = useState<boolean>(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [foundMember, setFoundMember] = useState<{
    memberId: string;
    displayName: string;
  } | null>(null);

  const label = identifierLabel?.trim() || 'Identifier';

  // If in pure list mode, delegate directly to NameClaimList
  if (claimMode !== 'identifier') {
    return (
      <NameClaimList
        members={members}
        onClaim={onClaim}
        isClaiming={isClaiming}
        error={error}
        className={className}
        selectedId={selectedId}
        onSelectId={onSelectId}
      />
    );
  }

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setIdentifierInput(e.target.value);
    // Clear confirmation box and errors if user edits the field
    setFoundMember(null);
    setSearchError(null);
  };

  const handleSearch = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const trimmed = identifierInput.trim();
    if (!trimmed || isSearching || isClaiming) return;

    setIsSearching(true);
    setSearchError(null);
    setFoundMember(null);

    try {
      const res = await lookupIdentifier(joinCode, trimmed);
      if (res.taken) {
        setSearchError(
          `That ${label} is already claimed. If it is you on a new phone, ask the group creator to reset it.`,
        );
      } else if (res.display_name) {
        setFoundMember({
          memberId: res.member_id,
          displayName: res.display_name,
        });
      }
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.code === 'not_found' || err.status === 404) {
          setSearchError(`We could not find that ${label}. Check it and try again.`);
        } else if (err.code === 'rate_limited' || err.status === 429) {
          setSearchError('Too many attempts. Please wait a minute and try again.');
        } else {
          setSearchError(getFriendlyErrorMessage(err));
        }
      } else {
        setSearchError(getFriendlyErrorMessage(err));
      }
    } finally {
      setIsSearching(false);
    }
  };

  const handleConfirmClaim = async () => {
    if (!foundMember) return;

    // Check stored identity before claiming (Part 3C protection)
    const existing = getMemberIdentity(joinCode);
    if (existing) {
      setSearchError(`This browser is already signed in as ${existing.displayName}.`);
      setFoundMember(null);
      return;
    }

    await onClaim(foundMember.memberId, foundMember.displayName);
  };

  const handleResetSearch = () => {
    setFoundMember(null);
    setSearchError(null);
  };

  return (
    <div className={`space-y-5 ${className}`.trim()}>
      <div className="space-y-1">
        <h2 className="text-lg font-bold text-neutral-900">Find your name</h2>
        <p className="text-sm text-neutral-600">
          Enter your {label} to claim your name in this group.
        </p>
      </div>

      {searchError && (
        <Banner type="error" title="Could not find member">
          {searchError}
        </Banner>
      )}

      {error && !searchError && (
        <Banner type="error" title="Could not claim name">
          {error}
        </Banner>
      )}

      <form onSubmit={handleSearch} className="space-y-3">
        <div className="space-y-1.5">
          <label
            htmlFor="identifier-input"
            className="block text-sm font-semibold text-neutral-800"
          >
            {label}
          </label>
          <div className="flex gap-2">
            <input
              id="identifier-input"
              type="text"
              autoComplete="off"
              disabled={isSearching || isClaiming}
              value={identifierInput}
              onChange={handleInputChange}
              placeholder={`Enter your ${label}`}
              className="flex-1 px-3.5 py-2.5 rounded-xl border border-neutral-300 text-neutral-900 placeholder:text-neutral-400 focus:outline-none focus:ring-2 focus:ring-indigo-600 focus:border-transparent min-h-[44px] text-sm"
            />
            <Button
              type="submit"
              variant="primary"
              size="md"
              disabled={!identifierInput.trim() || isSearching || isClaiming}
              loading={isSearching}
            >
              Find me
            </Button>
          </div>
        </div>
      </form>

      {/* Found Confirmation Box */}
      {foundMember && (
        <div className="p-4 bg-indigo-50/80 border border-indigo-200 rounded-2xl space-y-3 animate-in fade-in duration-150">
          <div className="text-sm text-neutral-700">
            <span>Is this you? </span>
            <strong className="text-base text-indigo-950 font-bold block sm:inline mt-0.5 sm:mt-0">
              {foundMember.displayName}
            </strong>
          </div>
          <div className="flex gap-2">
            <Button
              variant="primary"
              size="md"
              fullWidth
              loading={isClaiming}
              onClick={handleConfirmClaim}
            >
              Yes, that's me
            </Button>
            <Button
              variant="secondary"
              size="md"
              disabled={isClaiming}
              onClick={handleResetSearch}
            >
              No, try again
            </Button>
          </div>
        </div>
      )}

      {/* Optional Name List fallback if allow_name_list is enabled */}
      {allowNameList && (
        <div className="pt-2">
          <div className="relative my-6">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-neutral-200" />
            </div>
            <div className="relative flex justify-center text-xs uppercase">
              <span className="bg-white px-3 text-neutral-500 font-medium">
                Or pick your name from the list
              </span>
            </div>
          </div>

          <NameClaimList
            members={members}
            onClaim={onClaim}
            isClaiming={isClaiming}
            error={null}
            selectedId={selectedId}
            onSelectId={onSelectId}
          />
        </div>
      )}
    </div>
  );
};
