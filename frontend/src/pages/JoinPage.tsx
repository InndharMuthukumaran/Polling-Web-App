import React, { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  claimMember,
  getJoinInfo,
  getMe,
  getMyPolls,
} from '../api/endpoints';
import { ApiError, getFriendlyErrorMessage } from '../api/client';
import type {
  JoinGroupResponse,
  MemberPollSummary,
  MeResponse,
  StoredMemberIdentity,
} from '../api/types';
import {
  clearMemberIdentity,
  getMemberIdentity,
  saveMemberIdentity,
} from '../lib/storage';
import { formatDateTime } from '../lib/time';
import { Card } from '../components/Card';
import { Button } from '../components/Button';
import { Banner } from '../components/Banner';
import { Spinner } from '../components/Spinner';
import { Badge } from '../components/Badge';
import { NameClaimList } from '../components/NameClaimList';
import { SwitchNameAction } from '../components/SwitchNameAction';

export const JoinPage: React.FC = () => {
  const { joinCode } = useParams<{ joinCode: string }>();

  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [groupInfo, setGroupInfo] = useState<JoinGroupResponse | null>(null);

  const [identity, setIdentity] = useState<StoredMemberIdentity | null>(null);
  const [claimStatus, setClaimStatus] = useState<'approved' | 'pending' | null>(null);
  const [, setMemberProfile] = useState<MeResponse | null>(null);
  const [polls, setPolls] = useState<MemberPollSummary[]>([]);

  const [selectedMemberId, setSelectedMemberId] = useState<string | null>(null);
  const [isClaiming, setIsClaiming] = useState<boolean>(false);
  const [claimError, setClaimError] = useState<string | null>(null);
  const [isCheckingApproval, setIsCheckingApproval] = useState<boolean>(false);
  const [alreadySignedInNote, setAlreadySignedInNote] = useState<string | null>(null);

  // Check approval status for pending/approved member
  const checkApproval = useCallback(
    async (token: string, silent = false) => {
      if (!silent) setIsCheckingApproval(true);
      try {
        const me = await getMe(token);
        setMemberProfile(me);
        if (me.claim_status === 'approved') {
          setClaimStatus('approved');
          const myPolls = await getMyPolls(token);
          setPolls(myPolls);
        } else {
          setClaimStatus('pending');
        }
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) {
          if (joinCode) clearMemberIdentity(joinCode);
          setIdentity(null);
          setClaimStatus(null);
          setMemberProfile(null);
        }
      } finally {
        if (!silent) setIsCheckingApproval(false);
      }
    },
    [joinCode],
  );

  // Initial load: group info + verify stored identity
  useEffect(() => {
    let isMounted = true;

    async function init() {
      if (!joinCode) {
        setError('Missing join code in link.');
        setLoading(false);
        return;
      }

      setLoading(true);
      setError(null);

      try {
        const group = await getJoinInfo(joinCode);
        if (!isMounted) return;
        setGroupInfo(group);

        const stored = getMemberIdentity(joinCode);
        if (stored) {
          try {
            const me = await getMe(stored.memberToken);
            if (!isMounted) return;
            setIdentity(stored);
            setMemberProfile(me);

            if (me.claim_status === 'approved') {
              setClaimStatus('approved');
              const myPolls = await getMyPolls(stored.memberToken);
              if (isMounted) setPolls(myPolls);
            } else {
              setClaimStatus('pending');
            }
          } catch (authErr) {
            if (!isMounted) return;
            if (authErr instanceof ApiError && authErr.status === 401) {
              clearMemberIdentity(joinCode);
              setIdentity(null);
              setClaimStatus(null);
            }
          }
        }
      } catch (err) {
        if (!isMounted) return;
        if (err instanceof ApiError && err.code === 'not_found') {
          setError('This join link is invalid or the group does not exist.');
        } else {
          setError(getFriendlyErrorMessage(err));
        }
      } finally {
        if (isMounted) {
          setLoading(false);
        }
      }
    }

    init();

    return () => {
      isMounted = false;
    };
  }, [joinCode]);

  // Periodic polling every 10 seconds if claim is pending
  useEffect(() => {
    if (claimStatus !== 'pending' || !identity?.memberToken) {
      return;
    }

    const intervalId = window.setInterval(() => {
      checkApproval(identity.memberToken, true);
    }, 10000);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [claimStatus, identity, checkApproval]);

  // Keep list fresh: while claim list is showing (!identity), reload on visibilitychange / focus
  useEffect(() => {
    if (identity || !joinCode) return;

    const reloadMembers = async () => {
      try {
        const refreshed = await getJoinInfo(joinCode);
        setGroupInfo(refreshed);
      } catch {
        // ignore
      }
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        reloadMembers();
      }
    };

    const handleFocus = () => {
      reloadMembers();
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('focus', handleFocus);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('focus', handleFocus);
    };
  }, [identity, joinCode]);

  // Other tabs follow along: listen to window storage event for group key
  useEffect(() => {
    if (!joinCode) return;
    const targetKey = `pollapp.member.${joinCode}`;

    const handleStorage = async (e: StorageEvent) => {
      if (e.key === targetKey || e.key === null) {
        const stored = getMemberIdentity(joinCode);
        if (stored) {
          setIdentity(stored);
          setClaimError(null);
          setAlreadySignedInNote(null);
          await checkApproval(stored.memberToken);
        } else {
          setIdentity(null);
          setClaimStatus(null);
          setMemberProfile(null);
          setPolls([]);
          setAlreadySignedInNote(null);
          try {
            const refreshed = await getJoinInfo(joinCode);
            setGroupInfo(refreshed);
          } catch {
            // ignore
          }
        }
      }
    };

    window.addEventListener('storage', handleStorage);
    return () => {
      window.removeEventListener('storage', handleStorage);
    };
  }, [joinCode, checkApproval]);

  // Claim name handler
  const handleClaim = async (memberId: string) => {
    if (!joinCode || !groupInfo) return;

    // Never overwrite an existing identity: re-read getMemberIdentity right before claim
    const existing = getMemberIdentity(joinCode);
    if (existing) {
      setIdentity(existing);
      setAlreadySignedInNote(`This browser is already signed in as ${existing.displayName}.`);
      setClaimError(null);
      await checkApproval(existing.memberToken);
      return;
    }

    setIsClaiming(true);
    setClaimError(null);
    setAlreadySignedInNote(null);

    try {
      const result = await claimMember(joinCode, memberId);
      const chosenMember = groupInfo.members.find((m) => m.id === memberId);
      const displayName = chosenMember ? chosenMember.display_name : '';

      const newIdentity: StoredMemberIdentity = {
        memberToken: result.member_token,
        memberId: result.member_id,
        displayName,
      };

      saveMemberIdentity(joinCode, newIdentity);
      setIdentity(newIdentity);
      setClaimStatus(result.status);

      if (result.status === 'approved') {
        const myPolls = await getMyPolls(result.member_token);
        setPolls(myPolls);
      }
    } catch (err) {
      if (err instanceof ApiError && err.code === 'name_already_claimed') {
        const chosenMember = groupInfo.members.find((m) => m.id === memberId);
        const chosenName = chosenMember ? chosenMember.display_name : 'That name';

        setSelectedMemberId(null);
        try {
          const refreshed = await getJoinInfo(joinCode);
          setGroupInfo(refreshed);
        } catch {
          // ignore
        }
        setClaimError(`${chosenName} was just taken by someone else. Please pick another name.`);
      } else {
        setClaimError(getFriendlyErrorMessage(err));
      }
    } finally {
      setIsClaiming(false);
    }
  };

  const handleSwitchNameReleased = async () => {
    setIdentity(null);
    setClaimStatus(null);
    setMemberProfile(null);
    setPolls([]);
    setSelectedMemberId(null);
    setAlreadySignedInNote(null);

    if (joinCode) {
      try {
        const refreshed = await getJoinInfo(joinCode);
        setGroupInfo(refreshed);
      } catch {
        // ignore
      }
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen py-16 px-4 flex flex-col items-center justify-center">
        <div className="text-center space-y-3">
          <Spinner size="lg" label="Loading group..." />
          <p className="text-sm text-neutral-500 font-medium">Loading group details...</p>
        </div>
      </div>
    );
  }

  if (error || !groupInfo) {
    return (
      <div className="min-h-screen py-12 px-4 flex flex-col items-center justify-center">
        <div className="w-full max-w-md">
          <Card className="space-y-4 text-center">
            <div className="w-12 h-12 rounded-2xl bg-rose-50 text-rose-600 flex items-center justify-center mx-auto">
              <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
            </div>
            <div className="space-y-1">
              <h1 className="text-xl font-bold text-neutral-900">Group not found</h1>
              <p className="text-sm text-neutral-600">
                {error || 'This group join link could not be loaded.'}
              </p>
            </div>
            <div className="pt-2">
              <Link to="/">
                <Button variant="secondary" fullWidth>
                  Return to Home
                </Button>
              </Link>
            </div>
          </Card>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen py-8 px-4 flex flex-col items-center">
      <div className="w-full max-w-md space-y-6">
        {/* Group Header Card */}
        <Card className="space-y-2">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-indigo-600">
            <span>Group Invitation</span>
          </div>
          <h1 className="text-2xl font-bold text-neutral-900 tracking-tight">
            {groupInfo.group_name}
          </h1>
          <p className="text-sm text-neutral-500">
            Join code: <code className="font-mono bg-neutral-100 px-1.5 py-0.5 rounded text-neutral-800">{joinCode}</code>
          </p>
        </Card>

        {/* State 1: Claimed & Approved */}
        {identity && claimStatus === 'approved' && (
          <Card className="space-y-6">
            {alreadySignedInNote && (
              <Banner type="info">{alreadySignedInNote}</Banner>
            )}

            <div className="p-4 bg-emerald-50/80 border border-emerald-200 rounded-xl space-y-2">
              <div className="flex items-center justify-between max-[480px]:flex-col max-[480px]:items-start max-[480px]:gap-2">
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-emerald-600" aria-hidden="true" />
                  <span className="text-xs font-bold uppercase tracking-wider text-emerald-800">
                    Recognized Member
                  </span>
                </div>
                <SwitchNameAction
                  className="max-[480px]:w-full"
                  displayName={identity.displayName}
                  memberToken={identity.memberToken}
                  joinCode={joinCode!}
                  onReleased={handleSwitchNameReleased}
                />
              </div>

              <p className="text-base text-neutral-900 font-semibold">
                You are <span className="text-emerald-800">{identity.displayName}</span> in {groupInfo.group_name}
              </p>

              <p className="text-xs text-neutral-600">
                This browser is signed in as {identity.displayName}. To let someone else use this device, tap 'Not you? Switch name'.
              </p>
            </div>

            <div className="space-y-3">
              <h2 className="text-lg font-bold text-neutral-900">Group Polls</h2>
              {polls.length === 0 ? (
                <p className="text-sm text-neutral-500 py-3 text-center border border-dashed border-neutral-200 rounded-xl">
                  No polls have been created in this group yet.
                </p>
              ) : (
                <div className="space-y-2.5">
                  {polls.map((poll) => (
                    <Link
                      key={poll.id}
                      to={`/p/${poll.id}`}
                      className="block p-4 rounded-xl border border-neutral-200 hover:border-indigo-300 hover:bg-neutral-50/80 transition-all min-h-[44px] group"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <span className="font-semibold text-neutral-900 group-hover:text-indigo-600 transition-colors">
                          {poll.name}
                        </span>
                        <Badge status={poll.status} />
                      </div>
                      {poll.deadline && (
                        <p className="text-xs text-neutral-500 mt-1">
                          Deadline: {formatDateTime(poll.deadline)}
                        </p>
                      )}
                    </Link>
                  ))}
                </div>
              )}
            </div>
          </Card>
        )}

        {/* State 2: Claimed & Pending */}
        {identity && claimStatus === 'pending' && (
          <Card className="space-y-5 text-center py-6">
            {alreadySignedInNote && (
              <Banner type="info">{alreadySignedInNote}</Banner>
            )}

            <div className="w-12 h-12 rounded-2xl bg-amber-50 text-amber-600 flex items-center justify-center mx-auto">
              <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <div className="space-y-1">
              <h2 className="text-lg font-bold text-neutral-900">
                Waiting for the group creator to approve you
              </h2>
              <p className="text-sm text-neutral-600">
                You claimed <span className="font-semibold text-neutral-900">{identity.displayName}</span>. Once approved by the creator, you can vote and view poll results.
              </p>
              <p className="text-xs text-neutral-500">
                This browser is signed in as {identity.displayName}. To let someone else use this device, tap 'Not you? Switch name'.
              </p>
            </div>

            <div className="flex flex-col gap-2 pt-2 items-center">
              <Button
                variant="primary"
                fullWidth
                loading={isCheckingApproval}
                onClick={() => checkApproval(identity.memberToken, false)}
              >
                Check again
              </Button>
              <SwitchNameAction
                displayName={identity.displayName}
                memberToken={identity.memberToken}
                joinCode={joinCode!}
                onReleased={handleSwitchNameReleased}
              />
            </div>

            <p className="text-xs text-neutral-400">
              Checking automatically every 10 seconds...
            </p>
          </Card>
        )}

        {/* State 3: New device (No Identity) */}
        {!identity && (
          <Card>
            <NameClaimList
              members={groupInfo.members}
              selectedId={selectedMemberId}
              onSelectId={setSelectedMemberId}
              onClaim={handleClaim}
              isClaiming={isClaiming}
              error={claimError}
            />
          </Card>
        )}
      </div>
    </div>
  );
};
