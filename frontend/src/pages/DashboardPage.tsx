import React, { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Card } from '../components/Card';
import { Button } from '../components/Button';
import { Banner } from '../components/Banner';
import { Spinner } from '../components/Spinner';
import { Badge } from '../components/Badge';
import {
  addMembers,
  approveMemberClaim,
  getGroup,
  getGroupPolls,
  resetMemberClaim,
  updateGroup,
  updateMember,
} from '../api/endpoints';
import { ApiError, getFriendlyErrorMessage } from '../api/client';
import { clearAdmin, getAdmin, saveAdmin } from '../lib/adminStorage';
import { copyToClipboard } from '../lib/messages';
import { describeDeadline } from '../lib/time';
import type { AdminGroupDetailResponse, AdminPollListItem, GroupMember } from '../api/types';

export const DashboardPage: React.FC = () => {
  const { groupId } = useParams<{ groupId: string }>();
  const navigate = useNavigate();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isAuthError, setIsAuthError] = useState(false);

  const [group, setGroup] = useState<AdminGroupDetailResponse | null>(null);
  const [polls, setPolls] = useState<AdminPollListItem[]>([]);

  // Reconnect token form
  const [reconnectToken, setReconnectToken] = useState('');
  const [isReconnecting, setIsReconnecting] = useState(false);
  const [reconnectError, setReconnectError] = useState<string | null>(null);

  // Actions state
  const [copiedLink, setCopiedLink] = useState(false);
  const [isUpdatingApproval, setIsUpdatingApproval] = useState(false);

  // Add members state
  const [newMembersText, setNewMembersText] = useState('');
  const [isAddingMembers, setIsAddingMembers] = useState(false);
  const [addMembersError, setAddMembersError] = useState<string | null>(null);

  // Member action states
  const [resetConfirmMemberId, setResetConfirmMemberId] = useState<string | null>(null);
  const [renameMemberId, setRenameMemberId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [actionLoadingId, setActionLoadingId] = useState<string | null>(null);
  const [memberActionError, setMemberActionError] = useState<string | null>(null);

  const loadDashboard = useCallback(
    async (token: string, gid: string) => {
      setLoading(true);
      setError(null);
      setIsAuthError(false);

      try {
        const [groupData, pollsData] = await Promise.all([
          getGroup(gid, token),
          getGroupPolls(gid, token),
        ]);
        setGroup(groupData);
        setPolls(pollsData);
      } catch (err) {
        if (err instanceof ApiError && (err.status === 401 || err.status === 403)) {
          setIsAuthError(true);
          clearAdmin(gid);
        } else {
          setError(getFriendlyErrorMessage(err));
        }
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  useEffect(() => {
    if (!groupId) {
      setError('Missing group ID.');
      setLoading(false);
      return;
    }

    const admin = getAdmin(groupId);
    if (!admin?.adminToken) {
      setIsAuthError(true);
      setLoading(false);
      return;
    }

    loadDashboard(admin.adminToken, groupId);
  }, [groupId, loadDashboard]);

  const handleReconnect = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!groupId || !reconnectToken.trim()) return;

    setIsReconnecting(true);
    setReconnectError(null);

    try {
      const tok = reconnectToken.trim();
      const groupData = await getGroup(groupId, tok);
      saveAdmin(groupId, { adminToken: tok, groupName: groupData.name });
      setIsAuthError(false);
      setGroup(groupData);
      const pollsData = await getGroupPolls(groupId, tok);
      setPolls(pollsData);
    } catch (err) {
      setReconnectError(getFriendlyErrorMessage(err));
    } finally {
      setIsReconnecting(false);
    }
  };

  const handleCopyJoinLink = async () => {
    if (!group) return;
    const origin = window.location.origin;
    const joinUrl = `${origin}/join/${group.join_code}`;
    const ok = await copyToClipboard(joinUrl);
    if (ok) {
      setCopiedLink(true);
      setTimeout(() => setCopiedLink(false), 2000);
    }
  };

  const handleToggleApproval = async () => {
    if (!groupId || !group) return;
    const admin = getAdmin(groupId);
    if (!admin?.adminToken) return;

    setIsUpdatingApproval(true);
    try {
      const updated = await updateGroup(groupId, admin.adminToken, {
        require_claim_approval: !group.require_claim_approval,
      });
      setGroup(updated);
    } catch (err) {
      setMemberActionError(getFriendlyErrorMessage(err));
    } finally {
      setIsUpdatingApproval(false);
    }
  };

  const handleAddMembers = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!groupId || !group) return;
    const admin = getAdmin(groupId);
    if (!admin?.adminToken) return;

    const names = newMembersText
      .split('\n')
      .map((n) => n.trim())
      .filter((n) => n.length > 0);

    if (names.length === 0) {
      setAddMembersError('Please enter at least one member name.');
      return;
    }

    setIsAddingMembers(true);
    setAddMembersError(null);

    try {
      await addMembers(groupId, admin.adminToken, names);
      setNewMembersText('');
      // Refresh group members
      const refreshed = await getGroup(groupId, admin.adminToken);
      setGroup(refreshed);
    } catch (err) {
      setAddMembersError(getFriendlyErrorMessage(err));
    } finally {
      setIsAddingMembers(false);
    }
  };

  const handleApprove = async (memberId: string) => {
    if (!groupId) return;
    const admin = getAdmin(groupId);
    if (!admin?.adminToken) return;

    setActionLoadingId(memberId);
    setMemberActionError(null);
    try {
      await approveMemberClaim(groupId, memberId, admin.adminToken);
      const refreshed = await getGroup(groupId, admin.adminToken);
      setGroup(refreshed);
    } catch (err) {
      setMemberActionError(getFriendlyErrorMessage(err));
    } finally {
      setActionLoadingId(null);
    }
  };

  const handleReset = async (memberId: string) => {
    if (!groupId) return;
    const admin = getAdmin(groupId);
    if (!admin?.adminToken) return;

    setActionLoadingId(memberId);
    setMemberActionError(null);
    try {
      await resetMemberClaim(groupId, memberId, admin.adminToken);
      setResetConfirmMemberId(null);
      const refreshed = await getGroup(groupId, admin.adminToken);
      setGroup(refreshed);
    } catch (err) {
      setMemberActionError(getFriendlyErrorMessage(err));
    } finally {
      setActionLoadingId(null);
    }
  };

  const handleToggleActive = async (member: GroupMember) => {
    if (!groupId) return;
    const admin = getAdmin(groupId);
    if (!admin?.adminToken) return;

    setActionLoadingId(member.id);
    setMemberActionError(null);
    try {
      await updateMember(groupId, member.id, admin.adminToken, {
        is_active: !member.is_active,
      });
      const refreshed = await getGroup(groupId, admin.adminToken);
      setGroup(refreshed);
    } catch (err) {
      setMemberActionError(getFriendlyErrorMessage(err));
    } finally {
      setActionLoadingId(null);
    }
  };

  const handleSaveRename = async (memberId: string) => {
    if (!groupId) return;
    const admin = getAdmin(groupId);
    if (!admin?.adminToken) return;
    const trimmed = renameValue.trim();
    if (!trimmed) {
      setMemberActionError('Display name cannot be blank.');
      return;
    }

    setActionLoadingId(memberId);
    setMemberActionError(null);
    try {
      await updateMember(groupId, memberId, admin.adminToken, {
        display_name: trimmed,
      });
      setRenameMemberId(null);
      setRenameValue('');
      const refreshed = await getGroup(groupId, admin.adminToken);
      setGroup(refreshed);
    } catch (err) {
      setMemberActionError(getFriendlyErrorMessage(err));
    } finally {
      setActionLoadingId(null);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen py-16 px-4 flex flex-col items-center justify-center">
        <div className="text-center space-y-3">
          <Spinner size="lg" label="Loading dashboard..." />
          <p className="text-sm text-neutral-500 font-medium">Loading group details...</p>
        </div>
      </div>
    );
  }

  // Auth Error or Missing Admin Token Screen
  if (isAuthError) {
    return (
      <div className="min-h-screen py-12 px-4 flex flex-col items-center justify-center">
        <div className="w-full max-w-md">
          <Card className="space-y-4">
            <div className="text-center space-y-1">
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
            </div>

            {reconnectError && <Banner type="error">{reconnectError}</Banner>}

            <form onSubmit={handleReconnect} className="space-y-3">
              <div className="space-y-1">
                <label
                  htmlFor="reconnect-token-input"
                  className="block text-xs font-semibold text-neutral-700"
                >
                  Admin Token
                </label>
                <input
                  id="reconnect-token-input"
                  type="password"
                  placeholder="Enter your group admin token"
                  value={reconnectToken}
                  onChange={(e) => setReconnectToken(e.target.value)}
                  className="w-full px-3.5 py-2.5 rounded-xl border border-neutral-300 text-neutral-900 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-600 min-h-[44px]"
                />
              </div>

              <Button type="submit" variant="primary" fullWidth loading={isReconnecting}>
                Reconnect Group
              </Button>
            </form>

            <div className="text-center pt-2">
              <Link to="/" className="text-xs font-semibold text-indigo-600 hover:underline">
                &larr; Return to Home
              </Link>
            </div>
          </Card>
        </div>
      </div>
    );
  }

  if (error || !group) {
    return (
      <div className="min-h-screen py-12 px-4 flex flex-col items-center justify-center">
        <div className="w-full max-w-md">
          <Card className="space-y-4 text-center">
            <h1 className="text-lg font-bold text-neutral-900">Unable to load group</h1>
            <p className="text-sm text-neutral-600">{error || 'Group not found.'}</p>
            <Button variant="secondary" onClick={() => navigate('/')}>
              Return Home
            </Button>
          </Card>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen py-8 px-4 flex flex-col items-center">
      <div className="w-full max-w-md space-y-6">
        {/* Navigation & Header */}
        <div className="space-y-1">
          <Link
            to="/"
            className="inline-flex items-center text-xs font-medium text-neutral-500 hover:text-neutral-900 transition-colors"
          >
            &larr; Back to Groups
          </Link>
          <div className="flex items-center justify-between gap-3">
            <h1 className="text-2xl font-bold text-neutral-900 tracking-tight">{group.name}</h1>
            <span className="text-xs font-mono bg-neutral-100 text-neutral-600 px-2 py-1 rounded-md">
              Admin
            </span>
          </div>
        </div>

        {/* Global Action Error Banner */}
        {memberActionError && (
          <Banner type="error" title="Action failed">
            {memberActionError}
          </Banner>
        )}

        {/* CARD 1: Share Card */}
        <Card className="space-y-4">
          <div className="space-y-1">
            <h2 className="text-base font-bold text-neutral-900">Group Invitation</h2>
            <p className="text-xs text-neutral-600">
              Share this link with your group members so they can join and claim their name.
            </p>
          </div>

          <div className="space-y-1.5">
            <label className="block text-xs font-semibold text-neutral-600 uppercase tracking-wider">
              Join Link
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                readOnly
                value={`${window.location.origin}/join/${group.join_code}`}
                className="w-full text-xs font-mono bg-neutral-50 border border-neutral-200 rounded-xl px-3 py-2.5 text-neutral-800 select-all"
              />
              <Button type="button" variant="secondary" size="sm" onClick={handleCopyJoinLink}>
                {copiedLink ? 'Copied' : 'Copy'}
              </Button>
            </div>
          </div>

          <div className="pt-2 border-t border-neutral-100">
            <label className="flex items-start gap-3 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={group.require_claim_approval}
                disabled={isUpdatingApproval}
                onChange={handleToggleApproval}
                className="mt-1 w-4 h-4 rounded text-indigo-600 focus:ring-indigo-500 border-neutral-300"
              />
              <div>
                <span className="text-sm font-medium text-neutral-900 block">
                  Require my approval before a member can vote
                </span>
                <span className="text-xs text-neutral-500 block">
                  When enabled, member name claims stay pending until you approve them.
                </span>
              </div>
            </label>
          </div>
        </Card>

        {/* CARD 2: Members Card */}
        <Card className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-bold text-neutral-900">
              Members ({group.members.length})
            </h2>
          </div>

          {/* Members List */}
          <div className="space-y-2">
            {group.members.length === 0 ? (
              <p className="text-sm text-neutral-500 text-center py-3">
                No members added yet. Add member names below.
              </p>
            ) : (
              group.members.map((member) => {
                const isResetting = resetConfirmMemberId === member.id;
                const isRenaming = renameMemberId === member.id;
                const isLoading = actionLoadingId === member.id;

                let statusBadge = (
                  <Badge status="not_claimed" label="Not claimed" />
                );
                if (!member.is_active) {
                  statusBadge = <Badge status="inactive" label="Inactive" />;
                } else if (member.claim_status === 'pending') {
                  statusBadge = <Badge status="waiting" label="Waiting for approval" />;
                } else if (member.claim_status === 'approved') {
                  statusBadge = <Badge status="claimed" label="Claimed" />;
                }

                return (
                  <div
                    key={member.id}
                    className="p-3.5 rounded-xl border border-neutral-200 bg-neutral-50/50 space-y-2.5"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span
                          className={`font-semibold text-sm ${
                            member.is_active ? 'text-neutral-900' : 'text-neutral-400 line-through'
                          }`}
                        >
                          {member.display_name}
                        </span>
                        {statusBadge}
                      </div>
                    </div>

                    {/* Inline Rename Form */}
                    {isRenaming ? (
                      <div className="flex gap-2 pt-1">
                        <input
                          type="text"
                          value={renameValue}
                          onChange={(e) => setRenameValue(e.target.value)}
                          className="w-full text-xs px-3 py-1.5 border border-neutral-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-600"
                        />
                        <Button
                          size="sm"
                          variant="primary"
                          loading={isLoading}
                          onClick={() => handleSaveRename(member.id)}
                        >
                          Save
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => {
                            setRenameMemberId(null);
                            setRenameValue('');
                          }}
                        >
                          Cancel
                        </Button>
                      </div>
                    ) : null}

                    {/* Reset Confirmation Dialog */}
                    {isResetting ? (
                      <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl space-y-2 text-xs text-amber-950">
                        <p>
                          <strong>Reset claim?</strong> The next person to claim this name will keep
                          its previous votes and history.
                        </p>
                        <div className="flex gap-2">
                          <Button
                            size="sm"
                            variant="danger"
                            loading={isLoading}
                            onClick={() => handleReset(member.id)}
                          >
                            Confirm Reset
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => setResetConfirmMemberId(null)}
                          >
                            Cancel
                          </Button>
                        </div>
                      </div>
                    ) : null}

                    {/* Action Buttons Row */}
                    {!isRenaming && !isResetting && (
                      <div className="flex items-center gap-2 pt-1 flex-wrap">
                        {/* Approve: only for waiting/pending */}
                        {member.is_active && member.claim_status === 'pending' && (
                          <Button
                            size="sm"
                            variant="primary"
                            loading={isLoading}
                            onClick={() => handleApprove(member.id)}
                          >
                            Approve
                          </Button>
                        )}

                        {/* Reset: only for waiting or claimed */}
                        {(member.claim_status === 'pending' ||
                          member.claim_status === 'approved') && (
                          <Button
                            size="sm"
                            variant="secondary"
                            disabled={isLoading}
                            onClick={() => setResetConfirmMemberId(member.id)}
                          >
                            Reset
                          </Button>
                        )}

                        {/* Rename */}
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={isLoading}
                          onClick={() => {
                            setRenameMemberId(member.id);
                            setRenameValue(member.display_name);
                          }}
                        >
                          Rename
                        </Button>

                        {/* Deactivate or Reactivate */}
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={isLoading}
                          onClick={() => handleToggleActive(member)}
                        >
                          {member.is_active ? 'Deactivate' : 'Reactivate'}
                        </Button>
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>

          {/* Add Members Section */}
          <div className="pt-3 border-t border-neutral-100 space-y-3">
            <div className="space-y-1">
              <label
                htmlFor="add-members-textarea"
                className="block text-xs font-semibold text-neutral-700"
              >
                Add members
              </label>
              <p className="text-xs text-neutral-500">
                Enter names one per line. Blank lines are ignored.
              </p>
            </div>

            {addMembersError && <Banner type="error">{addMembersError}</Banner>}

            <form onSubmit={handleAddMembers} className="space-y-2">
              <textarea
                id="add-members-textarea"
                rows={3}
                placeholder="Alice Cooper&#10;Bob Smith&#10;Charlie Brown"
                value={newMembersText}
                onChange={(e) => setNewMembersText(e.target.value)}
                className="w-full px-3 py-2 text-sm rounded-xl border border-neutral-300 focus:outline-none focus:ring-2 focus:ring-indigo-600"
              />
              <Button type="submit" variant="secondary" size="md" fullWidth loading={isAddingMembers}>
                Add Members
              </Button>
            </form>
          </div>
        </Card>

        {/* CARD 3: Polls Card */}
        <Card className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-bold text-neutral-900">Polls ({polls.length})</h2>
            <Link to={`/g/${groupId}/polls/new`}>
              <Button variant="primary" size="sm">
                New poll
              </Button>
            </Link>
          </div>

          <div className="space-y-2">
            {polls.length === 0 ? (
              <p className="text-sm text-neutral-500 text-center py-4">
                No polls created yet. Click &quot;New poll&quot; to create one.
              </p>
            ) : (
              polls.map((poll) => (
                <Link
                  key={poll.id}
                  to={`/g/${groupId}/polls/${poll.id}`}
                  className="block p-3.5 rounded-xl border border-neutral-200 bg-white hover:border-indigo-300 hover:bg-neutral-50/80 transition-all min-h-[44px]"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="space-y-1">
                      <span className="font-semibold text-sm text-neutral-900 block">
                        {poll.name}
                      </span>
                      <span className="text-xs text-neutral-500 block">
                        {describeDeadline(poll.deadline)}
                      </span>
                    </div>
                    <Badge status={poll.status} />
                  </div>
                </Link>
              ))
            )}
          </div>
        </Card>
      </div>
    </div>
  );
};
