import React, { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Card } from '../components/Card';
import { Button } from '../components/Button';
import { Banner } from '../components/Banner';
import { Spinner } from '../components/Spinner';
import { Badge } from '../components/Badge';
import {
  getGroup,
  getGroupPolls,
  updateGroup,
} from '../api/endpoints';
import { ApiError, getFriendlyErrorMessage } from '../api/client';
import { clearAdmin, getAdmin, saveAdmin } from '../lib/adminStorage';
import { copyToClipboard } from '../lib/messages';
import { describeDeadline } from '../lib/time';
import type { AdminGroupDetailResponse, AdminPollListItem } from '../api/types';

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
  const [isUpdatingAllowNameList, setIsUpdatingAllowNameList] = useState(false);
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

  const handleToggleAllowNameList = async () => {
    if (!groupId || !group) return;
    const admin = getAdmin(groupId);
    if (!admin?.adminToken) return;

    setIsUpdatingAllowNameList(true);
    try {
      const updated = await updateGroup(groupId, admin.adminToken, {
        allow_name_list: !group.allow_name_list,
      });
      setGroup(updated);
    } catch (err) {
      setMemberActionError(getFriendlyErrorMessage(err));
    } finally {
      setIsUpdatingAllowNameList(false);
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

  const waitingApprovalCount = (group.members || []).filter(
    (m) => m.is_active && m.claim_status === 'pending',
  ).length;

  const identifierField = (group.fields || []).find((f) => f.is_identifier);

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

          <div className="pt-2 border-t border-neutral-100 space-y-3">
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

            <label className="flex items-start gap-3 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={Boolean(group.allow_name_list)}
                disabled={isUpdatingAllowNameList}
                onChange={handleToggleAllowNameList}
                className="mt-1 w-4 h-4 rounded text-indigo-600 focus:ring-indigo-500 border-neutral-300"
              />
              <div>
                <span className="text-sm font-medium text-neutral-900 block">
                  Show the list of names on the join page
                </span>
                <span className="text-xs text-neutral-500 block">
                  When your group has an identifier field, members claim their name by typing it, and this list is hidden. Turn this on only for small, friendly groups.
                </span>
              </div>
            </label>

            {identifierField && (
              <p className="text-xs text-neutral-600 bg-neutral-50 border border-neutral-200 p-2.5 rounded-xl">
                {`Members claim their name by entering their ${identifierField.name}.`}
              </p>
            )}
          </div>
        </Card>

        {/* CARD 2: Roster Card */}
        <Card className="space-y-4">
          <div className="flex items-start justify-between gap-3">
            <div className="space-y-1">
              <h2 className="text-base font-bold text-neutral-900">Roster</h2>
              <div className="flex items-center gap-3 text-sm text-neutral-600 flex-wrap">
                <span>
                  <strong className="font-semibold text-neutral-900">
                    {`${group.members?.length || 0} ${group.members?.length === 1 ? 'member' : 'members'}`}
                  </strong>
                </span>
                <span className="text-neutral-300">&bull;</span>
                <span>
                  <strong className="font-semibold text-neutral-900">
                    {`${group.fields?.length || 0} ${(group.fields?.length || 0) === 1 ? 'field' : 'fields'}`}
                  </strong>
                </span>
              </div>
            </div>

            {waitingApprovalCount > 0 && (
              <Badge
                status="waiting"
                label={`${waitingApprovalCount} waiting for approval`}
              />
            )}
          </div>

          <Link
            to={`/g/${groupId}/roster`}
            className="w-full inline-flex items-center justify-center font-medium rounded-xl transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-600 bg-neutral-100 text-neutral-800 hover:bg-neutral-200 text-sm px-4 py-2.5 min-h-[44px]"
          >
            Manage roster
          </Link>
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
