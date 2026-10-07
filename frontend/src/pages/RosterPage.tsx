import React, { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Card } from '../components/Card';
import { Button } from '../components/Button';
import { Banner } from '../components/Banner';
import { Spinner } from '../components/Spinner';
import { getGroup } from '../api/endpoints';
import { ApiError, getFriendlyErrorMessage } from '../api/client';
import { clearAdmin, getAdmin, saveAdmin } from '../lib/adminStorage';
import type { AdminGroupDetailResponse } from '../api/types';
import { MembersTab } from '../components/roster/MembersTab';
import { FieldsTab } from '../components/roster/FieldsTab';
import { ImportTab } from '../components/roster/ImportTab';

type TabKey = 'members' | 'fields' | 'import';

export const RosterPage: React.FC = () => {
  const { groupId } = useParams<{ groupId: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();

  const tabParam = searchParams.get('tab') as TabKey | null;
  const activeTab: TabKey =
    tabParam === 'fields' || tabParam === 'import' ? tabParam : 'members';

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isAuthError, setIsAuthError] = useState(false);
  const [group, setGroup] = useState<AdminGroupDetailResponse | null>(null);

  // Reconnect token form
  const [reconnectToken, setReconnectToken] = useState('');
  const [isReconnecting, setIsReconnecting] = useState(false);
  const [reconnectError, setReconnectError] = useState<string | null>(null);

  const loadRoster = useCallback(
    async (token: string, gid: string) => {
      setLoading(true);
      setError(null);
      setIsAuthError(false);

      try {
        const groupData = await getGroup(gid, token);
        setGroup(groupData);
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

    loadRoster(admin.adminToken, groupId);
  }, [groupId, loadRoster]);

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
    } catch (err) {
      setReconnectError(getFriendlyErrorMessage(err));
    } finally {
      setIsReconnecting(false);
    }
  };

  const handleRefresh = async () => {
    if (!groupId) return;
    const admin = getAdmin(groupId);
    if (!admin?.adminToken) return;
    const groupData = await getGroup(groupId, admin.adminToken);
    setGroup(groupData);
  };

  const setTab = (newTab: TabKey) => {
    setSearchParams({ tab: newTab });
  };

  if (loading) {
    return (
      <div className="min-h-screen py-16 px-4 flex flex-col items-center justify-center">
        <div className="text-center space-y-3">
          <Spinner size="lg" label="Loading roster..." />
          <p className="text-sm text-neutral-500 font-medium">Loading roster details...</p>
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

  if (error || !group || !groupId) {
    return (
      <div className="min-h-screen py-12 px-4 flex flex-col items-center justify-center">
        <div className="w-full max-w-md">
          <Card className="space-y-4 text-center">
            <h1 className="text-lg font-bold text-neutral-900">Unable to load roster</h1>
            <p className="text-sm text-neutral-600">{error || 'Group not found.'}</p>
            <Button variant="secondary" onClick={() => navigate('/')}>
              Return Home
            </Button>
          </Card>
        </div>
      </div>
    );
  }

  const admin = getAdmin(groupId);
  const adminToken = admin?.adminToken ?? '';

  return (
    <div className="min-h-screen py-8 px-4 flex flex-col items-center">
      <div className="w-full max-w-4xl space-y-6">
        {/* Navigation & Header */}
        <div className="space-y-1">
          <Link
            to={`/g/${groupId}`}
            className="inline-flex items-center text-xs font-medium text-neutral-500 hover:text-neutral-900 transition-colors"
          >
            &larr; Back to Dashboard
          </Link>
          <div className="flex items-center justify-between gap-3">
            <div>
              <h1 className="text-2xl font-bold text-neutral-900 tracking-tight">Roster Management</h1>
              <p className="text-xs text-neutral-500 font-medium">{group.name}</p>
            </div>
            <span className="text-xs font-mono bg-neutral-100 text-neutral-600 px-2 py-1 rounded-md">
              Admin
            </span>
          </div>
        </div>

        {/* Tab Navigation */}
        <div className="flex border-b border-neutral-200 gap-6">
          <button
            type="button"
            onClick={() => setTab('members')}
            className={`pb-3 text-sm font-semibold transition-colors border-b-2 cursor-pointer ${
              activeTab === 'members'
                ? 'border-indigo-600 text-indigo-600'
                : 'border-transparent text-neutral-500 hover:text-neutral-800'
            }`}
          >
            Members ({group.members.length})
          </button>

          <button
            type="button"
            onClick={() => setTab('fields')}
            className={`pb-3 text-sm font-semibold transition-colors border-b-2 cursor-pointer ${
              activeTab === 'fields'
                ? 'border-indigo-600 text-indigo-600'
                : 'border-transparent text-neutral-500 hover:text-neutral-800'
            }`}
          >
            Fields ({group.fields?.length || 0})
          </button>

          <button
            type="button"
            onClick={() => setTab('import')}
            className={`pb-3 text-sm font-semibold transition-colors border-b-2 cursor-pointer ${
              activeTab === 'import'
                ? 'border-indigo-600 text-indigo-600'
                : 'border-transparent text-neutral-500 hover:text-neutral-800'
            }`}
          >
            Import
          </button>
        </div>

        {/* Tab Content */}
        {activeTab === 'members' && (
          <MembersTab
            groupId={groupId}
            adminToken={adminToken}
            fields={group.fields || []}
            members={group.members || []}
            onRefresh={handleRefresh}
          />
        )}

        {activeTab === 'fields' && (
          <FieldsTab
            groupId={groupId}
            adminToken={adminToken}
            fields={group.fields || []}
            members={group.members || []}
            onRefresh={handleRefresh}
          />
        )}

        {activeTab === 'import' && (
          <ImportTab
            groupId={groupId}
            adminToken={adminToken}
            fields={group.fields || []}
            members={group.members || []}
            onRefresh={handleRefresh}
            onSwitchToMembers={() => setTab('members')}
          />
        )}
      </div>
    </div>
  );
};
