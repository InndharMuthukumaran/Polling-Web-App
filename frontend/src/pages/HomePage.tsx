import React, { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Card } from '../components/Card';
import { Button } from '../components/Button';
import { Banner } from '../components/Banner';
import { createGroup, getGroup } from '../api/endpoints';
import { getFriendlyErrorMessage } from '../api/client';
import { listAdminGroups, saveAdmin } from '../lib/adminStorage';
import { copyToClipboard } from '../lib/messages';
import type { CreateGroupResponse } from '../api/types';

export const HomePage: React.FC = () => {
  const navigate = useNavigate();

  // Create Group State
  const [newGroupName, setNewGroupName] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  // Created Group Modal / Reveal Screen State
  const [createdGroup, setCreatedGroup] = useState<CreateGroupResponse | null>(null);
  const [hasSavedToken, setHasSavedToken] = useState(false);
  const [copiedField, setCopiedField] = useState<'id' | 'token' | null>(null);

  // Connect Existing Group State
  const [connectId, setConnectId] = useState('');
  const [connectToken, setConnectToken] = useState('');
  const [isConnecting, setIsConnecting] = useState(false);
  const [connectError, setConnectError] = useState<string | null>(null);

  // Saved Groups
  const [savedGroups, setSavedGroups] = useState<
    Array<{ groupId: string; groupName: string; adminToken: string }>
  >([]);

  useEffect(() => {
    setSavedGroups(listAdminGroups());
  }, []);

  const handleCreateGroup = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = newGroupName.trim();
    if (!trimmed) {
      setCreateError('Group name is required.');
      return;
    }

    setIsCreating(true);
    setCreateError(null);

    try {
      const res = await createGroup(trimmed);
      saveAdmin(res.group_id, {
        adminToken: res.admin_token,
        groupName: res.name,
      });
      setCreatedGroup(res);
      setSavedGroups(listAdminGroups());
      setNewGroupName('');
    } catch (err) {
      setCreateError(getFriendlyErrorMessage(err));
    } finally {
      setIsCreating(false);
    }
  };

  const handleConnectGroup = async (e: React.FormEvent) => {
    e.preventDefault();
    const gid = connectId.trim();
    const tok = connectToken.trim();

    if (!gid || !tok) {
      setConnectError('Both Group ID and Admin Token are required.');
      return;
    }

    setIsConnecting(true);
    setConnectError(null);

    try {
      const group = await getGroup(gid, tok);
      saveAdmin(group.id, {
        adminToken: tok,
        groupName: group.name,
      });
      navigate(`/g/${group.id}`);
    } catch (err) {
      setConnectError(getFriendlyErrorMessage(err));
    } finally {
      setIsConnecting(false);
    }
  };

  const handleCopy = async (text: string, field: 'id' | 'token') => {
    const ok = await copyToClipboard(text);
    if (ok) {
      setCopiedField(field);
      setTimeout(() => setCopiedField(null), 2000);
    }
  };

  // If a group was just created, show the "Save your creator access" screen
  if (createdGroup) {
    return (
      <div className="min-h-screen py-8 px-4 flex flex-col items-center">
        <div className="w-full max-w-md space-y-6">
          <Card className="space-y-5">
            <div className="space-y-1 text-center">
              <span className="inline-block px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
                Group Created
              </span>
              <h1 className="text-xl font-bold text-neutral-900">Save your creator access</h1>
              <p className="text-sm text-neutral-600">
                Your group <strong className="text-neutral-900">{createdGroup.name}</strong> is ready.
              </p>
            </div>

            <Banner type="warning" title="Important Warning">
              This is the only time the token is shown. There is no way to recover it. Anyone who has it can manage this group.
            </Banner>

            <div className="space-y-4">
              <div className="space-y-1">
                <label className="block text-xs font-semibold text-neutral-600 uppercase tracking-wider">
                  Group ID
                </label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    readOnly
                    value={createdGroup.group_id}
                    className="w-full text-xs font-mono bg-neutral-50 border border-neutral-200 rounded-xl px-3 py-2.5 text-neutral-800 select-all"
                  />
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={() => handleCopy(createdGroup.group_id, 'id')}
                  >
                    {copiedField === 'id' ? 'Copied' : 'Copy'}
                  </Button>
                </div>
              </div>

              <div className="space-y-1">
                <label className="block text-xs font-semibold text-neutral-600 uppercase tracking-wider">
                  Admin Token
                </label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    readOnly
                    value={createdGroup.admin_token}
                    className="w-full text-xs font-mono bg-neutral-50 border border-neutral-200 rounded-xl px-3 py-2.5 text-neutral-800 select-all"
                  />
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={() => handleCopy(createdGroup.admin_token, 'token')}
                  >
                    {copiedField === 'token' ? 'Copied' : 'Copy'}
                  </Button>
                </div>
              </div>

              <div className="pt-2">
                <label className="flex items-start gap-3 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={hasSavedToken}
                    onChange={(e) => setHasSavedToken(e.target.checked)}
                    className="mt-1 w-4 h-4 rounded text-indigo-600 focus:ring-indigo-500 border-neutral-300"
                  />
                  <span className="text-sm font-medium text-neutral-800">
                    I have saved it
                  </span>
                </label>
              </div>

              <Button
                type="button"
                variant="primary"
                fullWidth
                disabled={!hasSavedToken}
                onClick={() => navigate(`/g/${createdGroup.group_id}`)}
              >
                Go to my group
              </Button>
            </div>
          </Card>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen py-8 px-4 flex flex-col items-center">
      <div className="w-full max-w-md space-y-6">
        {/* App Title Header */}
        <div className="text-center space-y-2 py-2">
          <div className="w-12 h-12 rounded-2xl bg-indigo-600 text-white flex items-center justify-center mx-auto shadow-md">
            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"
              />
            </svg>
          </div>
          <h1 className="text-2xl font-bold text-neutral-900 tracking-tight">Polling App</h1>
          <p className="text-xs text-neutral-500 font-medium">Group Chat Polling & Tracking</p>
        </div>

        {/* Member notice */}
        <div className="p-3.5 bg-neutral-50 border border-neutral-200/80 rounded-xl text-center text-xs text-neutral-600">
          Have a poll link? Just open it.
        </div>

        {/* Section 1: Create a Group */}
        <Card className="space-y-4">
          <div className="space-y-1">
            <h2 className="text-lg font-bold text-neutral-900">Create a group</h2>
            <p className="text-sm text-neutral-600">
              Create a group to add members, organize polls, and track attendance or goals.
            </p>
          </div>

          {createError && <Banner type="error">{createError}</Banner>}

          <form onSubmit={handleCreateGroup} className="space-y-3">
            <div className="space-y-1">
              <label htmlFor="group-name-input" className="block text-xs font-semibold text-neutral-700">
                Group Name
              </label>
              <input
                id="group-name-input"
                type="text"
                placeholder="e.g. Weekend Football, Book Club"
                value={newGroupName}
                onChange={(e) => setNewGroupName(e.target.value)}
                className="w-full px-3.5 py-2.5 rounded-xl border border-neutral-300 text-neutral-900 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-600 min-h-[44px]"
              />
            </div>
            <Button type="submit" variant="primary" fullWidth loading={isCreating}>
              Create
            </Button>
          </form>
        </Card>

        {/* Section 2: Your Groups (if any saved) */}
        {savedGroups.length > 0 && (
          <Card className="space-y-3">
            <h2 className="text-base font-bold text-neutral-900">Your groups</h2>
            <div className="space-y-2">
              {savedGroups.map((g) => (
                <Link
                  key={g.groupId}
                  to={`/g/${g.groupId}`}
                  className="block p-3.5 rounded-xl border border-neutral-200 bg-white hover:border-indigo-300 hover:bg-neutral-50/80 transition-all min-h-[44px]"
                >
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-sm text-neutral-900">{g.groupName}</span>
                    <span className="text-xs text-neutral-400 font-mono">
                      {g.groupId.slice(0, 8)}...
                    </span>
                  </div>
                </Link>
              ))}
            </div>
          </Card>
        )}

        {/* Section 3: Connect an Existing Group */}
        <Card className="space-y-4">
          <div className="space-y-1">
            <h2 className="text-base font-bold text-neutral-900">Connect an existing group</h2>
            <p className="text-xs text-neutral-600">
              Access an existing group on this device using your creator credentials.
            </p>
          </div>

          {connectError && <Banner type="error">{connectError}</Banner>}

          <form onSubmit={handleConnectGroup} className="space-y-3">
            <div className="space-y-1">
              <label htmlFor="connect-id-input" className="block text-xs font-semibold text-neutral-700">
                Group ID
              </label>
              <input
                id="connect-id-input"
                type="text"
                placeholder="UUID of your group"
                value={connectId}
                onChange={(e) => setConnectId(e.target.value)}
                className="w-full px-3.5 py-2.5 rounded-xl border border-neutral-300 text-neutral-900 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-600 min-h-[44px]"
              />
            </div>

            <div className="space-y-1">
              <label htmlFor="connect-token-input" className="block text-xs font-semibold text-neutral-700">
                Admin Token
              </label>
              <input
                id="connect-token-input"
                type="password"
                placeholder="Secret creator token"
                value={connectToken}
                onChange={(e) => setConnectToken(e.target.value)}
                className="w-full px-3.5 py-2.5 rounded-xl border border-neutral-300 text-neutral-900 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-600 min-h-[44px]"
              />
            </div>

            <Button type="submit" variant="secondary" fullWidth loading={isConnecting}>
              Connect
            </Button>
          </form>
        </Card>
      </div>
    </div>
  );
};
