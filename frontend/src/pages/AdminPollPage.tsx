import React, { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Card } from '../components/Card';
import { Button } from '../components/Button';
import { Banner } from '../components/Banner';
import { Spinner } from '../components/Spinner';
import { Badge } from '../components/Badge';
import { closePoll, getAdminPollHistory, getAdminPollStatus } from '../api/endpoints';
import { ApiError, getFriendlyErrorMessage } from '../api/client';
import { getAdmin } from '../lib/adminStorage';
import {
  buildAnnouncement,
  buildReminder,
  copyToClipboard,
  namesForCopy,
} from '../lib/messages';
import { describeDeadline, formatDateTime } from '../lib/time';
import type { AdminPollHistoryResponse, AdminPollStatusResponse } from '../api/types';

export const AdminPollPage: React.FC = () => {
  const { groupId, pollId } = useParams<{ groupId: string; pollId: string }>();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isAuthError, setIsAuthError] = useState(false);

  const [statusData, setStatusData] = useState<AdminPollStatusResponse | null>(null);
  const [historyData, setHistoryData] = useState<AdminPollHistoryResponse | null>(null);

  // Copy feedback states
  const [copiedLink, setCopiedLink] = useState(false);
  const [copiedAnnouncement, setCopiedAnnouncement] = useState(false);
  const [copiedReminder, setCopiedReminder] = useState(false);
  const [copiedDefaulters, setCopiedDefaulters] = useState(false);
  const [copiedSection, setCopiedSection] = useState<string | null>(null);

  // History collapsed state
  const [historyOpen, setHistoryOpen] = useState(false);

  // Close poll confirmation dialog
  const [showCloseConfirm, setShowCloseConfirm] = useState(false);
  const [isClosing, setIsClosing] = useState(false);
  const [closeError, setCloseError] = useState<string | null>(null);

  const loadPollData = useCallback(
    async (pid: string, token: string, silent = false) => {
      if (!silent) setLoading(true);
      setError(null);

      try {
        const [stat, hist] = await Promise.all([
          getAdminPollStatus(pid, token),
          getAdminPollHistory(pid, token),
        ]);
        setStatusData(stat);
        setHistoryData(hist);
        setIsAuthError(false);
      } catch (err) {
        if (err instanceof ApiError && (err.status === 401 || err.status === 403)) {
          setIsAuthError(true);
        } else {
          setError(getFriendlyErrorMessage(err));
        }
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [],
  );

  useEffect(() => {
    if (!groupId || !pollId) {
      setError('Missing group ID or poll ID.');
      setLoading(false);
      return;
    }

    const admin = getAdmin(groupId);
    if (!admin?.adminToken) {
      setIsAuthError(true);
      setLoading(false);
      return;
    }

    loadPollData(pollId, admin.adminToken, false);
  }, [groupId, pollId, loadPollData]);

  // Periodic polling every 15s if poll is open and document is visible
  useEffect(() => {
    if (!groupId || !pollId || !statusData) return;
    if (statusData.poll.status !== 'open') return;

    const admin = getAdmin(groupId);
    if (!admin?.adminToken) return;

    const intervalId = window.setInterval(() => {
      if (document.visibilityState === 'visible') {
        loadPollData(pollId, admin.adminToken, true);
      }
    }, 15000);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [groupId, pollId, statusData, loadPollData]);

  const handleClosePoll = async () => {
    if (!groupId || !pollId) return;
    const admin = getAdmin(groupId);
    if (!admin?.adminToken) return;

    setIsClosing(true);
    setCloseError(null);

    try {
      await closePoll(pollId, admin.adminToken);
      setShowCloseConfirm(false);
      // Immediate refresh after action
      await loadPollData(pollId, admin.adminToken, true);
    } catch (err) {
      setCloseError(getFriendlyErrorMessage(err));
    } finally {
      setIsClosing(false);
    }
  };

  const getPublicLink = () => {
    return `${window.location.origin}/p/${pollId}`;
  };

  const handleCopyLink = async () => {
    const ok = await copyToClipboard(getPublicLink());
    if (ok) {
      setCopiedLink(true);
      setTimeout(() => setCopiedLink(false), 2000);
    }
  };

  const handleCopyAnnouncement = async () => {
    if (!statusData) return;
    const text = buildAnnouncement(
      {
        name: statusData.poll.name,
        deadline: statusData.poll.deadline,
      },
      getPublicLink(),
    );
    const ok = await copyToClipboard(text);
    if (ok) {
      setCopiedAnnouncement(true);
      setTimeout(() => setCopiedAnnouncement(false), 2000);
    }
  };

  const handleCopyReminder = async () => {
    if (!statusData) return;
    const text = buildReminder(
      {
        name: statusData.poll.name,
        deadline: statusData.poll.deadline,
      },
      getPublicLink(),
    );
    const ok = await copyToClipboard(text);
    if (ok) {
      setCopiedReminder(true);
      setTimeout(() => setCopiedReminder(false), 2000);
    }
  };

  const handleCopyDefaulters = async () => {
    if (!statusData) return;
    const defaulters = [...statusData.not_voted, ...statusData.behind_target];
    const text = namesForCopy(defaulters);
    const ok = await copyToClipboard(text);
    if (ok) {
      setCopiedDefaulters(true);
      setTimeout(() => setCopiedDefaulters(false), 2000);
    }
  };

  const handleCopySectionNames = async (
    sectionName: string,
    items: Array<{ display_name: string }>,
  ) => {
    const text = namesForCopy(items);
    const ok = await copyToClipboard(text);
    if (ok) {
      setCopiedSection(sectionName);
      setTimeout(() => setCopiedSection(null), 2000);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen py-16 px-4 flex flex-col items-center justify-center">
        <div className="text-center space-y-3">
          <Spinner size="lg" label="Loading poll status..." />
          <p className="text-sm text-neutral-500 font-medium">Loading poll details...</p>
        </div>
      </div>
    );
  }

  if (isAuthError) {
    return (
      <div className="min-h-screen py-12 px-4 flex flex-col items-center justify-center">
        <div className="w-full max-w-md">
          <Card className="space-y-4 text-center">
            <div className="w-12 h-12 rounded-2xl bg-amber-50 text-amber-600 flex items-center justify-center mx-auto">
              <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
                />
              </svg>
            </div>
            <h1 className="text-lg font-bold text-neutral-900">Creator Access Required</h1>
            <p className="text-sm text-neutral-600">
              Your creator access for this group is not valid on this device.
            </p>
            <div className="pt-2">
              <Link to={groupId ? `/g/${groupId}` : '/'}>
                <Button variant="primary" fullWidth>
                  Reconnect Group
                </Button>
              </Link>
            </div>
          </Card>
        </div>
      </div>
    );
  }

  if (error || !statusData) {
    return (
      <div className="min-h-screen py-12 px-4 flex flex-col items-center justify-center">
        <div className="w-full max-w-md">
          <Card className="space-y-4 text-center">
            <h1 className="text-lg font-bold text-neutral-900">Unable to load poll</h1>
            <p className="text-sm text-neutral-600">{error || 'Poll not found.'}</p>
            <Link to={groupId ? `/g/${groupId}` : '/'}>
              <Button variant="secondary">Back to Group</Button>
            </Link>
          </Card>
        </div>
      </div>
    );
  }

  const { poll, counts, all_reached, at_target, excused, behind_target, not_voted } = statusData;
  const lateCount = at_target.filter((m) => m.late).length;
  const totalDefaultersCount = not_voted.length + behind_target.length;

  return (
    <div className="min-h-screen py-8 px-4 flex flex-col items-center">
      <div className="w-full max-w-md space-y-6">
        {/* Navigation & Header */}
        <div className="space-y-2">
          <Link
            to={`/g/${groupId}`}
            className="inline-flex items-center text-xs font-medium text-neutral-500 hover:text-neutral-900 transition-colors"
          >
            &larr; Back to Dashboard
          </Link>
          <div className="space-y-1">
            <div className="flex items-center justify-between gap-3">
              <h1 className="text-2xl font-bold text-neutral-900 tracking-tight">{poll.name}</h1>
              <Badge status={poll.status} />
            </div>
            <p className="text-xs text-neutral-500">{describeDeadline(poll.deadline)}</p>
          </div>
        </div>

        {/* ALL REACHED BANNER */}
        {all_reached && poll.status === 'open' && (
          <Banner
            type="success"
            title="Goal Reached!"
            action={
              <Button
                size="sm"
                variant="primary"
                onClick={() => setShowCloseConfirm(true)}
              >
                Close Poll
              </Button>
            }
          >
            Everyone has reached the target. Close the poll?
          </Banner>
        )}

        {/* Closed Poll Notice */}
        {poll.status === 'closed' && (
          <Banner type="info" title="This poll is closed">
            Voting is closed and all selections are locked.
          </Banner>
        )}

        {closeError && <Banner type="error">{closeError}</Banner>}

        {/* CARD 1: Share & Chat Templates */}
        <Card className="space-y-4">
          <div className="space-y-1">
            <h2 className="text-base font-bold text-neutral-900">Share with Members</h2>
            <p className="text-xs text-neutral-600">
              Share the voting link or copy formatted message templates for your group chat.
            </p>
          </div>

          <div className="space-y-1.5">
            <label className="block text-xs font-semibold text-neutral-600 uppercase tracking-wider">
              Poll Voting Link
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                readOnly
                value={getPublicLink()}
                className="w-full text-xs font-mono bg-neutral-50 border border-neutral-200 rounded-xl px-3 py-2.5 text-neutral-800 select-all"
              />
              <Button type="button" variant="secondary" size="sm" onClick={handleCopyLink}>
                {copiedLink ? 'Copied' : 'Copy'}
              </Button>
            </div>
          </div>

          <div className="flex gap-2 pt-1">
            <Button
              type="button"
              variant="outline"
              size="sm"
              fullWidth
              onClick={handleCopyAnnouncement}
            >
              {copiedAnnouncement ? 'Copied Announcement' : 'Copy announcement'}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              fullWidth
              onClick={handleCopyReminder}
            >
              {copiedReminder ? 'Copied Reminder' : 'Copy reminder'}
            </Button>
          </div>
        </Card>

        {/* CARD 2: Summary Metrics */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="p-3.5 bg-emerald-50/70 border border-emerald-200 rounded-2xl text-center">
            <div className="text-2xl font-bold text-emerald-800">{counts.at_target}</div>
            <div className="text-xs font-medium text-emerald-950 mt-0.5">Done</div>
            {lateCount > 0 && (
              <span className="inline-block mt-1 text-[10px] font-semibold text-rose-600 bg-rose-50 border border-rose-200 px-1.5 py-0.5 rounded-full">
                {lateCount} Late
              </span>
            )}
          </div>

          <div className="p-3.5 bg-amber-50/70 border border-amber-200 rounded-2xl text-center">
            <div className="text-2xl font-bold text-amber-800">{counts.behind_target}</div>
            <div className="text-xs font-medium text-amber-950 mt-0.5">Behind</div>
          </div>

          <div className="p-3.5 bg-indigo-50/70 border border-indigo-200 rounded-2xl text-center">
            <div className="text-2xl font-bold text-indigo-800">{counts.excused}</div>
            <div className="text-xs font-medium text-indigo-950 mt-0.5">Excused</div>
          </div>

          <div className="p-3.5 bg-neutral-100/80 border border-neutral-200 rounded-2xl text-center">
            <div className="text-2xl font-bold text-neutral-800">{counts.not_voted}</div>
            <div className="text-xs font-medium text-neutral-900 mt-0.5">Not voted</div>
          </div>
        </div>

        {/* CARD 3: Prominent "Copy Defaulters" Action */}
        <Card className="space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-base font-bold text-neutral-900">Defaulters List</h2>
              <p className="text-xs text-neutral-500">
                Members who have not voted or are behind the target.
              </p>
            </div>
            <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-rose-50 text-rose-700 border border-rose-200">
              {totalDefaultersCount} Total
            </span>
          </div>

          <Button
            type="button"
            variant="danger"
            size="md"
            fullWidth
            onClick={handleCopyDefaulters}
          >
            {copiedDefaulters
              ? 'Copied to clipboard'
              : `Copy defaulters (${totalDefaultersCount})`}
          </Button>
        </Card>

        {/* SECTION 4: Defaulter Lists Breakdown */}
        <div className="space-y-4">
          {/* Section: Not Voted */}
          <Card className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-neutral-900">
                Not voted ({not_voted.length})
              </h3>
              <button
                type="button"
                onClick={() => handleCopySectionNames('not_voted', not_voted)}
                className="text-xs font-semibold text-indigo-600 hover:underline cursor-pointer"
              >
                {copiedSection === 'not_voted' ? 'Copied' : 'Copy names'}
              </button>
            </div>
            {not_voted.length === 0 ? (
              <p className="text-xs text-neutral-400">Everyone has voted.</p>
            ) : (
              <ul className="space-y-1.5">
                {not_voted.map((m) => (
                  <li
                    key={m.member_id}
                    className="p-2 text-xs font-medium bg-neutral-50 border border-neutral-200/80 rounded-lg text-neutral-800"
                  >
                    {m.display_name}
                  </li>
                ))}
              </ul>
            )}
          </Card>

          {/* Section: Behind Target */}
          <Card className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-neutral-900">
                Behind target ({behind_target.length})
              </h3>
              <button
                type="button"
                onClick={() => handleCopySectionNames('behind_target', behind_target)}
                className="text-xs font-semibold text-indigo-600 hover:underline cursor-pointer"
              >
                {copiedSection === 'behind_target' ? 'Copied' : 'Copy names'}
              </button>
            </div>
            {behind_target.length === 0 ? (
              <p className="text-xs text-neutral-400">No members behind target.</p>
            ) : (
              <ul className="space-y-1.5">
                {behind_target.map((m) => (
                  <li
                    key={m.member_id}
                    className="p-2 text-xs font-medium bg-amber-50/60 border border-amber-200/80 rounded-lg text-amber-950"
                  >
                    {m.display_name}
                  </li>
                ))}
              </ul>
            )}
          </Card>

          {/* Section: Excused */}
          <Card className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-neutral-900">
                Excused ({excused.length})
              </h3>
              <button
                type="button"
                onClick={() => handleCopySectionNames('excused', excused)}
                className="text-xs font-semibold text-indigo-600 hover:underline cursor-pointer"
              >
                {copiedSection === 'excused' ? 'Copied' : 'Copy names'}
              </button>
            </div>
            {excused.length === 0 ? (
              <p className="text-xs text-neutral-400">No excused members.</p>
            ) : (
              <ul className="space-y-1.5">
                {excused.map((m) => (
                  <li
                    key={m.member_id}
                    className="p-2 text-xs font-medium bg-indigo-50/60 border border-indigo-200/80 rounded-lg text-indigo-950"
                  >
                    {m.display_name}
                  </li>
                ))}
              </ul>
            )}
          </Card>

          {/* Section: Done (at target) */}
          <Card className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-neutral-900">
                Done ({at_target.length})
              </h3>
              <button
                type="button"
                onClick={() => handleCopySectionNames('at_target', at_target)}
                className="text-xs font-semibold text-indigo-600 hover:underline cursor-pointer"
              >
                {copiedSection === 'at_target' ? 'Copied' : 'Copy names'}
              </button>
            </div>
            {at_target.length === 0 ? (
              <p className="text-xs text-neutral-400">No members have reached the target yet.</p>
            ) : (
              <ul className="space-y-1.5">
                {at_target.map((m) => (
                  <li
                    key={m.member_id}
                    className="p-2.5 text-xs bg-emerald-50/60 border border-emerald-200/80 rounded-lg flex items-center justify-between gap-2"
                  >
                    <span className="font-semibold text-emerald-950">{m.display_name}</span>
                    <div className="flex items-center gap-1.5">
                      {m.late && (
                        <span className="text-[10px] font-bold uppercase tracking-wider text-rose-700 bg-rose-100 px-1.5 py-0.5 rounded">
                          Late
                        </span>
                      )}
                      {m.completed_at && (
                        <span className="text-[11px] text-emerald-800 font-mono">
                          {formatDateTime(m.completed_at)}
                        </span>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        {/* SECTION 5: Voting History (Collapsible) */}
        <Card className="space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-base font-bold text-neutral-900">Voting History</h2>
              <p className="text-xs text-neutral-500">
                First selected: when member first chose option. Last selected: most recent selection.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setHistoryOpen((prev) => !prev)}
              className="text-xs font-semibold text-indigo-600 hover:underline"
            >
              {historyOpen ? 'Hide' : 'Show'}
            </button>
          </div>

          {historyOpen && (
            <div className="pt-2 border-t border-neutral-100 space-y-3">
              {!historyData || historyData.length === 0 ? (
                <p className="text-xs text-neutral-400 text-center py-2">
                  No voting activity recorded yet.
                </p>
              ) : (
                historyData.map((member) => (
                  <div
                    key={member.member_id}
                    className="p-3 bg-neutral-50 rounded-xl border border-neutral-200 text-xs space-y-2"
                  >
                    <span className="font-bold text-neutral-900 block">
                      {member.display_name}
                    </span>
                    {member.history.length === 0 ? (
                      <p className="text-neutral-400">No votes recorded.</p>
                    ) : (
                      <div className="space-y-1.5">
                        {member.history.map((h) => (
                          <div
                            key={h.option_id}
                            className="p-2 bg-white rounded-lg border border-neutral-200/80 space-y-1"
                          >
                            <div className="flex items-center justify-between">
                              <span className="font-semibold text-neutral-800">
                                {h.option_label}
                              </span>
                              {h.is_selected && (
                                <span className="text-[10px] font-bold text-indigo-700 bg-indigo-50 border border-indigo-200 px-1.5 py-0.5 rounded">
                                  Selected now
                                </span>
                              )}
                            </div>
                            <div className="text-[11px] text-neutral-500 space-y-0.5">
                              <div>
                                First selected: {formatDateTime(h.first_selected_at)}
                              </div>
                              <div>
                                Last selected: {formatDateTime(h.last_selected_at)}
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          )}
        </Card>

        {/* SECTION 6: Close Poll Action */}
        {poll.status === 'open' && (
          <Card className="space-y-3">
            <h2 className="text-base font-bold text-neutral-900">Manage Poll</h2>
            {showCloseConfirm ? (
              <div className="p-3.5 bg-rose-50 border border-rose-200 rounded-xl space-y-3 text-xs text-rose-950">
                <p className="font-medium">
                  <strong>Are you sure you want to close this poll?</strong> Votes will be locked
                  and no further selections or changes can be made by members.
                </p>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="danger"
                    loading={isClosing}
                    onClick={handleClosePoll}
                  >
                    Confirm & Close Poll
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setShowCloseConfirm(false)}
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            ) : (
              <Button
                variant="outline"
                fullWidth
                onClick={() => setShowCloseConfirm(true)}
              >
                Close Poll
              </Button>
            )}
          </Card>
        )}
      </div>
    </div>
  );
};
