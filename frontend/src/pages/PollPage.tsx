import React, { useCallback, useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import {
  castVote,
  claimMember,
  deleteVote,
  getJoinInfo,
  getMe,
  getMyPollHistory,
  getPublicPoll,
} from '../api/endpoints';
import { ApiError, getFriendlyErrorMessage } from '../api/client';
import type {
  MemberPollHistoryItem,
  PublicPollResponse,
  StoredMemberIdentity,
} from '../api/types';
import {
  clearMemberIdentity,
  getMemberIdentity,
  saveMemberIdentity,
} from '../lib/storage';
import { describeDeadline, formatDateTime } from '../lib/time';
import { Card } from '../components/Card';
import { Button } from '../components/Button';
import { Banner } from '../components/Banner';
import { Spinner } from '../components/Spinner';
import { Badge } from '../components/Badge';
import { IdentifierClaim } from '../components/IdentifierClaim';
import { PollAnswersCard } from '../components/PollAnswersCard';
import { SwitchNameAction } from '../components/SwitchNameAction';
import type { JoinGroupResponse } from '../api/types';

export const PollPage: React.FC = () => {
  const { pollId } = useParams<{ pollId: string }>();

  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [poll, setPoll] = useState<PublicPollResponse | null>(null);

  // Group info for inline claim
  const [groupInfo, setGroupInfo] = useState<JoinGroupResponse | null>(null);

  // Member identity & claim state
  const [identity, setIdentity] = useState<StoredMemberIdentity | null>(null);
  const [claimStatus, setClaimStatus] = useState<'approved' | 'pending' | null>(null);
  const [selectedMemberId, setSelectedMemberId] = useState<string | null>(null);
  const [isClaiming, setIsClaiming] = useState<boolean>(false);
  const [claimError, setClaimError] = useState<string | null>(null);
  const [isCheckingApproval, setIsCheckingApproval] = useState<boolean>(false);
  const [alreadySignedInNote, setAlreadySignedInNote] = useState<string | null>(null);


  // Answers state for poll-only fields
  const [savedAnswers, setSavedAnswers] = useState<Record<string, string | number | null> | null>(null);
  const [savedAnswersUpdatedAt, setSavedAnswersUpdatedAt] = useState<string | null>(null);

  // Voting state
  const [selectedOptionIds, setSelectedOptionIds] = useState<string[]>([]);
  const [history, setHistory] = useState<MemberPollHistoryItem[]>([]);
  const [isVoting, setIsVoting] = useState<boolean>(false);
  const [voteError, setVoteError] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState<boolean>(false);

  // Load member history and active selections
  const loadMemberVotesAndHistory = useCallback(async (pid: string, token: string) => {
    try {
      const data = await getMyPollHistory(pid, token);
      setSelectedOptionIds(data.selected_option_ids);
      setHistory(data.history);
      setSavedAnswers(data.answers ?? {});
      setSavedAnswersUpdatedAt(data.answers_updated_at ?? null);
    } catch {
      // Ignore initial history failure
    }
  }, []);

  // Check approval status for pending member
  const checkApproval = useCallback(
    async (token: string, joinCode: string, silent = false) => {
      if (!silent) setIsCheckingApproval(true);
      try {
        const me = await getMe(token);
        if (me.claim_status === 'approved') {
          setClaimStatus('approved');
          if (pollId) {
            await loadMemberVotesAndHistory(pollId, token);
          }
        } else {
          setClaimStatus('pending');
        }
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) {
          clearMemberIdentity(joinCode);
          setIdentity(null);
          setClaimStatus(null);
          try {
            const info = await getJoinInfo(joinCode);
            setGroupInfo(info);
          } catch {
            // ignore
          }
        }
      } finally {
        if (!silent) setIsCheckingApproval(false);
      }
    },
    [pollId, loadMemberVotesAndHistory],
  );

  // Initial load: fetch poll and verify identity
  useEffect(() => {
    let isMounted = true;

    async function init() {
      if (!pollId) {
        setError('Missing poll ID in URL.');
        setLoading(false);
        return;
      }

      setLoading(true);
      setError(null);

      try {
        const pollData = await getPublicPoll(pollId);
        if (!isMounted) return;
        setPoll(pollData);

        const stored = getMemberIdentity(pollData.join_code);
        if (stored) {
          try {
            const me = await getMe(stored.memberToken);
            if (!isMounted) return;
            setIdentity(stored);

            if (me.claim_status === 'approved') {
              setClaimStatus('approved');
              await loadMemberVotesAndHistory(pollId, stored.memberToken);
            } else {
              setClaimStatus('pending');
            }
          } catch (authErr) {
            if (!isMounted) return;
            if (authErr instanceof ApiError && authErr.status === 401) {
              clearMemberIdentity(pollData.join_code);
              setIdentity(null);
              setClaimStatus(null);

              // Load member list for inline claim
              const info = await getJoinInfo(pollData.join_code);
              if (isMounted) setGroupInfo(info);
            }
          }
        } else {
          // No stored identity: load member list for inline claim
          const info = await getJoinInfo(pollData.join_code);
          if (isMounted) setGroupInfo(info);
        }
      } catch (err) {
        if (!isMounted) return;
        if (err instanceof ApiError && err.code === 'not_found') {
          setError('This poll does not exist or may have been deleted.');
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
  }, [pollId, loadMemberVotesAndHistory]);

  // Periodic polling every 10 seconds if claim is pending
  useEffect(() => {
    if (claimStatus !== 'pending' || !identity?.memberToken || !poll?.join_code) {
      return;
    }

    const intervalId = window.setInterval(() => {
      checkApproval(identity.memberToken, poll.join_code, true);
    }, 10000);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [claimStatus, identity, poll, checkApproval]);

  // Keep list fresh: while claim list is showing (!identity), reload on visibilitychange / focus
  useEffect(() => {
    if (identity || !poll?.join_code) return;

    const reloadMembers = async () => {
      try {
        const info = await getJoinInfo(poll.join_code);
        setGroupInfo(info);
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
  }, [identity, poll?.join_code]);

  // Other tabs follow along: listen to window storage event for group key
  useEffect(() => {
    if (!poll?.join_code) return;
    const targetKey = `pollapp.member.${poll.join_code}`;

    const handleStorage = async (e: StorageEvent) => {
      if (e.key === targetKey || e.key === null) {
        const stored = getMemberIdentity(poll.join_code);
        if (stored) {
          setIdentity(stored);
          setClaimError(null);
          setAlreadySignedInNote(null);
          await checkApproval(stored.memberToken, poll.join_code);
        } else {
          setIdentity(null);
          setClaimStatus(null);
          setSelectedOptionIds([]);
          setHistory([]);
          setSelectedMemberId(null);
          setAlreadySignedInNote(null);
          try {
            const info = await getJoinInfo(poll.join_code);
            setGroupInfo(info);
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
  }, [poll?.join_code, checkApproval]);

  // Handle inline claim
  const handleClaim = async (memberId: string, displayNameHint?: string) => {
    if (!poll) return;

    // Never overwrite an existing identity: re-read getMemberIdentity right before claim
    const existing = getMemberIdentity(poll.join_code);
    if (existing) {
      setIdentity(existing);
      setAlreadySignedInNote(`This browser is already signed in as ${existing.displayName}.`);
      setClaimError(null);
      await checkApproval(existing.memberToken, poll.join_code);
      return;
    }

    setIsClaiming(true);
    setClaimError(null);
    setAlreadySignedInNote(null);

    try {
      const result = await claimMember(poll.join_code, memberId);
      const chosenMember = (groupInfo?.members ?? []).find((m) => m.id === memberId);
      const displayName = chosenMember ? chosenMember.display_name : (displayNameHint || '');

      const newIdentity: StoredMemberIdentity = {
        memberToken: result.member_token,
        memberId: result.member_id,
        displayName,
      };

      saveMemberIdentity(poll.join_code, newIdentity);
      setIdentity(newIdentity);
      setClaimStatus(result.status);

      if (result.status === 'approved') {
        await loadMemberVotesAndHistory(poll.id, result.member_token);
      }
    } catch (err) {
      if (err instanceof ApiError && err.code === 'name_already_claimed') {
        const chosenMember = (groupInfo?.members ?? []).find((m) => m.id === memberId);
        const chosenName = chosenMember ? chosenMember.display_name : (displayNameHint || 'That name');

        setSelectedMemberId(null);
        try {
          const info = await getJoinInfo(poll.join_code);
          setGroupInfo(info);
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
    setSelectedOptionIds([]);
    setHistory([]);
    setSelectedMemberId(null);
    setAlreadySignedInNote(null);

    if (poll?.join_code) {
      try {
        const info = await getJoinInfo(poll.join_code);
        setGroupInfo(info);
      } catch {
        // ignore
      }
    }
  };


  // Handle vote toggle (cast or remove)
  const handleToggleVote = async (optionId: string, isCurrentlySelected: boolean) => {
    if (!poll || !identity || isVoting) return;

    setIsVoting(true);
    setVoteError(null);

    try {
      if (isCurrentlySelected) {
        // Tapping a selected option calls DELETE vote with that option_id
        const res = await deleteVote(poll.id, identity.memberToken, optionId);
        setSelectedOptionIds(res.selected_option_ids);
      } else {
        // Tapping an unselected option calls POST vote
        const res = await castVote(poll.id, optionId, identity.memberToken);
        setSelectedOptionIds(res.selected_option_ids);
      }
      // Refresh member history
      const histData = await getMyPollHistory(poll.id, identity.memberToken);
      setHistory(histData.history);
    } catch (err) {
      if (err instanceof ApiError && err.code === 'invalid_token') {
        clearMemberIdentity(poll.join_code);
        setIdentity(null);
        setClaimStatus(null);
        try {
          const info = await getJoinInfo(poll.join_code);
          setGroupInfo(info);
        } catch {
          // ignore
        }
      }
      setVoteError(getFriendlyErrorMessage(err));
    } finally {
      setIsVoting(false);
    }
  };

  // Handle clear all votes
  const handleClearAllVotes = async () => {
    if (!poll || !identity || isVoting) return;

    setIsVoting(true);
    setVoteError(null);

    try {
      const res = await deleteVote(poll.id, identity.memberToken);
      setSelectedOptionIds(res.selected_option_ids);
      const histData = await getMyPollHistory(poll.id, identity.memberToken);
      setHistory(histData.history);
    } catch (err) {
      if (err instanceof ApiError && err.code === 'invalid_token') {
        clearMemberIdentity(poll.join_code);
        setIdentity(null);
        setClaimStatus(null);
      }
      setVoteError(getFriendlyErrorMessage(err));
    } finally {
      setIsVoting(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen py-16 px-4 flex flex-col items-center justify-center">
        <div className="text-center space-y-3">
          <Spinner size="lg" label="Loading poll..." />
          <p className="text-sm text-neutral-500 font-medium">Loading poll...</p>
        </div>
      </div>
    );
  }

  if (error || !poll) {
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
              <h1 className="text-xl font-bold text-neutral-900">Poll not found</h1>
              <p className="text-sm text-neutral-600">
                {error || 'This poll could not be loaded.'}
              </p>
            </div>
          </Card>
        </div>
      </div>
    );
  }

  const isClosed = poll.status === 'closed';
  const isDeadlinePassed = Boolean(
    poll.deadline && new Date(poll.deadline).getTime() < Date.now(),
  );
  const sortedOptions = [...poll.options].sort((a, b) => a.position - b.position);

  return (
    <div className="min-h-screen py-8 px-4 flex flex-col items-center">
      <div className="w-full max-w-md space-y-5">
        {/* Poll Header Card */}
        <Card className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <span className="text-xs font-semibold uppercase tracking-wider text-indigo-600 truncate">
              {poll.group_name}
            </span>
            <Badge status={poll.status} />
          </div>

          <h1 className="text-2xl font-bold text-neutral-900 tracking-tight leading-snug">
            {poll.name}
          </h1>

          {poll.description_raw && (
            <p className="text-sm text-neutral-700 whitespace-pre-wrap leading-relaxed">
              {poll.description_raw}
            </p>
          )}

          {poll.deadline && (
            <div className="pt-2 border-t border-neutral-100 flex items-center gap-2 text-xs text-neutral-600">
              <svg className="w-4 h-4 text-neutral-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <span>
                {describeDeadline(poll.deadline)} ({formatDateTime(poll.deadline)})
              </span>
            </div>
          )}
        </Card>

        {/* State Banner: Closed Poll */}
        {isClosed && (
          <Banner type="warning" title="This poll is closed">
            No further votes can be cast or changed. You can still see your recorded selections and history below.
          </Banner>
        )}

        {/* State Banner: Open but Deadline Passed */}
        {!isClosed && isDeadlinePassed && (
          <Banner type="warning">
            The deadline has passed. You can still vote, and your vote will be marked late.
          </Banner>
        )}

        {/* State Banner: Vote Errors */}
        {voteError && (
          <Banner type="error" title="Vote not recorded">
            {voteError}
          </Banner>
        )}

        {/* SECTION A: Unrecognized device / No Identity -> Inline Name Claiming */}
        {!identity && (
          <Card>
            <div className="mb-2">
              <span className="inline-block px-2 py-0.5 rounded text-xs font-semibold bg-indigo-50 text-indigo-700 mb-2">
                Step 1 of 2
              </span>
            </div>
            <IdentifierClaim
              joinCode={poll.join_code}
              claimMode={groupInfo?.claim_mode}
              identifierLabel={groupInfo?.identifier_label}
              allowNameList={groupInfo?.allow_name_list}
              members={groupInfo?.members ?? []}
              selectedId={selectedMemberId}
              onSelectId={setSelectedMemberId}
              onClaim={handleClaim}
              isClaiming={isClaiming}
              error={claimError}
            />
          </Card>
        )}

        {/* SECTION B: Claimed & Pending -> Waiting Panel */}
        {identity && claimStatus === 'pending' && (
          <Card className="space-y-4 text-center py-6">
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
                You claimed <span className="font-semibold text-neutral-900">{identity.displayName}</span>. Once approved by the creator, you can vote on this poll.
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
                onClick={() => checkApproval(identity.memberToken, poll.join_code, false)}
              >
                Check again
              </Button>
              <SwitchNameAction
                displayName={identity.displayName}
                memberToken={identity.memberToken}
                joinCode={poll.join_code}
                onReleased={handleSwitchNameReleased}
              />
            </div>

            <p className="text-xs text-neutral-400">
              Checking automatically every 10 seconds...
            </p>
          </Card>
        )}

        {/* SECTION C: Recognized & Approved Member */}
        {identity && claimStatus === 'approved' && (
          <>
            {alreadySignedInNote && (
              <Banner type="info">{alreadySignedInNote}</Banner>
            )}

            {/* Member Identity Chip */}
            <div className="flex items-center justify-between text-xs px-2 text-neutral-500 max-[480px]:flex-col max-[480px]:items-start max-[480px]:gap-2">
              <div className="flex items-center gap-2 flex-wrap max-[480px]:w-full">
                <span>
                  Voting as <strong className="text-neutral-800">{identity.displayName}</strong>
                </span>
                <SwitchNameAction
                  className="max-[480px]:w-full"
                  displayName={identity.displayName}
                  memberToken={identity.memberToken}
                  joinCode={poll.join_code}
                  onReleased={handleSwitchNameReleased}
                />
              </div>
              <span>{poll.allow_multiple ? 'Multiple selections allowed' : 'Single selection'}</span>
            </div>
            <p className="text-xs text-neutral-500 px-2">
              This browser is signed in as {identity.displayName}. To let someone else use this device, tap 'Not you? Switch name'.
            </p>

            {/* Voting Options Card */}
            <Card className="space-y-4">

              <div className="space-y-2">
                {sortedOptions.map((option) => {
                  const isSelected = selectedOptionIds.includes(option.id);

                  if (isClosed) {
                    // Closed poll: non-interactive options display
                    return (
                      <div
                        key={option.id}
                        className={`w-full p-4 rounded-xl border text-left flex items-center justify-between min-h-[44px] ${
                          isSelected
                            ? 'border-indigo-600 bg-indigo-50/60 font-semibold text-indigo-950'
                            : 'border-neutral-200 bg-neutral-50 text-neutral-600'
                        }`}
                      >
                        <span>{option.label}</span>
                        {isSelected && (
                          <span className="text-xs font-bold text-indigo-700 bg-indigo-100 px-2 py-0.5 rounded-full">
                            Your Vote
                          </span>
                        )}
                      </div>
                    );
                  }

                  // Open poll: interactive toggle buttons
                  return (
                    <button
                      key={option.id}
                      type="button"
                      disabled={isVoting}
                      onClick={() => handleToggleVote(option.id, isSelected)}
                      className={`w-full p-4 rounded-xl border transition-all text-left flex items-center justify-between min-h-[44px] cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-600 focus-visible:ring-offset-2 ${
                        isSelected
                          ? 'border-indigo-600 bg-indigo-50/70 text-indigo-950 font-semibold ring-1 ring-indigo-600 shadow-sm'
                          : 'border-neutral-200 bg-white hover:border-neutral-300 hover:bg-neutral-50 text-neutral-800 font-medium'
                      } ${isVoting ? 'opacity-70 cursor-not-allowed' : ''}`}
                    >
                      <span className="text-base">{option.label}</span>
                      {/* Indicator: Radio for single-choice, Checkbox for multiple-choice */}
                      {poll.allow_multiple ? (
                        <span
                          data-indicator="checkbox"
                          className={`w-5 h-5 rounded-md border flex items-center justify-center transition-colors shrink-0 ${
                            isSelected
                              ? 'border-indigo-600 bg-indigo-600 text-white'
                              : 'border-neutral-300'
                          }`}
                          aria-hidden="true"
                        >
                          {isSelected && (
                            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                            </svg>
                          )}
                        </span>
                      ) : (
                        <span
                          data-indicator="radio"
                          className={`w-5 h-5 rounded-full border flex items-center justify-center transition-colors shrink-0 ${
                            isSelected
                              ? 'border-indigo-600 bg-white'
                              : 'border-neutral-300'
                          }`}
                          aria-hidden="true"
                        >
                          {isSelected && (
                            <span className="w-2.5 h-2.5 rounded-full bg-indigo-600" />
                          )}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>

              {/* Notice under voting area */}
              <p className="text-xs text-neutral-500 leading-relaxed pt-1">
                The poll creator can see when you first and last selected each option.
              </p>

              {/* Clear my vote link (open poll only) */}
              {!isClosed && selectedOptionIds.length > 0 && (
                <div className="pt-2 text-center border-t border-neutral-100">
                  <button
                    type="button"
                    disabled={isVoting}
                    onClick={handleClearAllVotes}
                    className="text-xs font-semibold text-rose-600 hover:text-rose-700 hover:underline min-h-[44px] px-3 inline-flex items-center cursor-pointer disabled:opacity-50"
                  >
                    Clear my vote
                  </button>
                </div>
              )}
            </Card>

            {/* Answers Card (Poll-only fields) */}
            {poll.poll_fields && poll.poll_fields.length > 0 && (
              <PollAnswersCard
                pollId={poll.id}
                pollFields={poll.poll_fields}
                savedAnswers={savedAnswers}
                savedUpdatedAt={savedAnswersUpdatedAt}
                isClosed={isClosed}
                memberToken={identity.memberToken}
                onAnswersSaved={(newAnswers, updatedAt) => {
                  setSavedAnswers(newAnswers);
                  setSavedAnswersUpdatedAt(updatedAt);
                }}
                onUnauthorized={async () => {
                  clearMemberIdentity(poll.join_code);
                  setIdentity(null);
                  setClaimStatus(null);
                  try {
                    const info = await getJoinInfo(poll.join_code);
                    setGroupInfo(info);
                  } catch {
                    // ignore
                  }
                }}
              />
            )}

            {/* Collapsible History Section */}
            <Card className="space-y-3">
              <button
                type="button"
                onClick={() => setHistoryOpen(!historyOpen)}
                className="w-full flex items-center justify-between text-left text-sm font-semibold text-neutral-800 min-h-[44px] cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-600 rounded-lg"
                aria-expanded={historyOpen}
              >
                <span>Your history</span>
                <span className="text-neutral-500 text-xs flex items-center gap-1 font-normal">
                  {history.length} {history.length === 1 ? 'record' : 'records'}
                  <svg
                    className={`w-4 h-4 transition-transform duration-200 ${historyOpen ? 'rotate-180' : ''}`}
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </span>
              </button>

              {historyOpen && (
                <div className="space-y-2.5 pt-2 border-t border-neutral-100 animate-in fade-in duration-150">
                  {history.length === 0 ? (
                    <p className="text-xs text-neutral-500 py-2">
                      You have not cast any votes on this poll yet.
                    </p>
                  ) : (
                    history.map((item) => (
                      <div
                        key={item.option_id}
                        className="p-3 bg-neutral-50 rounded-xl text-xs space-y-1 border border-neutral-100"
                      >
                        <div className="flex items-center justify-between">
                          <span className="font-bold text-neutral-900">{item.option_label}</span>
                          {item.is_selected && (
                            <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800">
                              Selected now
                            </span>
                          )}
                        </div>
                        <p className="text-neutral-600">
                          First selected {formatDateTime(item.first_selected_at)}. Last selected{' '}
                          {formatDateTime(item.last_selected_at)}.
                        </p>
                      </div>
                    ))
                  )}
                </div>
              )}
            </Card>
          </>
        )}
      </div>
    </div>
  );
};
