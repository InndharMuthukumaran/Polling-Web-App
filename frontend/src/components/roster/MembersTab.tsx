import React, { useState } from 'react';
import type { GroupField, GroupMember } from '../../api/types';
import {
  addMembers,
  approveMemberClaim,
  resetMemberClaim,
  updateMember,
} from '../../api/endpoints';
import { getFriendlyErrorMessage } from '../../api/client';
import { filterMembers, paginate } from '../../lib/rosterForm';
import { Button } from '../Button';
import { Card } from '../Card';
import { Badge } from '../Badge';
import { Banner } from '../Banner';
import { MemberModal } from './MemberModal';

interface MembersTabProps {
  groupId: string;
  adminToken: string;
  fields: GroupField[];
  members: GroupMember[];
  onRefresh: () => Promise<void>;
}

export const MembersTab: React.FC<MembersTabProps> = ({
  groupId,
  adminToken,
  fields,
  members,
  onRefresh,
}) => {
  // Search & Filter & Pagination
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [currentPage, setCurrentPage] = useState(1);

  // Add / Edit Modal State
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingMember, setEditingMember] = useState<GroupMember | null>(null);

  // Quick Add State
  const [showQuickAdd, setShowQuickAdd] = useState(false);
  const [quickAddText, setQuickAddText] = useState('');
  const [quickAddLoading, setQuickAddLoading] = useState(false);
  const [quickAddError, setQuickAddError] = useState<string | null>(null);

  // Member Action State
  const [resetConfirmId, setResetConfirmId] = useState<string | null>(null);
  const [actionLoadingId, setActionLoadingId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  // Expanded details on mobile cards
  const [expandedMemberIds, setExpandedMemberIds] = useState<Record<string, boolean>>({});

  const toggleDetails = (memberId: string) => {
    setExpandedMemberIds((prev) => ({
      ...prev,
      [memberId]: !prev[memberId],
    }));
  };

  // Find identifier field
  const identifierField = fields.find((f) => f.is_identifier);
  // Other fields sorted by position
  const otherFields = fields
    .filter((f) => !f.is_identifier)
    .sort((a, b) => a.position - b.position);

  // Filter & Paginate
  const filtered = filterMembers(members, searchQuery, statusFilter);
  const pageSize = 50;
  const paged = paginate(filtered, currentPage, pageSize);

  const handleOpenAdd = () => {
    setEditingMember(null);
    setIsModalOpen(true);
  };

  const handleOpenEdit = (m: GroupMember) => {
    setEditingMember(m);
    setIsModalOpen(true);
  };

  const handleSaveMember = async (
    displayName: string,
    values: Record<string, string | number | null>,
  ) => {
    if (editingMember) {
      await updateMember(groupId, editingMember.id, adminToken, {
        display_name: displayName,
        values,
      });
    } else {
      await addMembers(groupId, adminToken, [{ display_name: displayName, values }]);
    }
    await onRefresh();
  };

  const handleApprove = async (memberId: string) => {
    setActionLoadingId(memberId);
    setActionError(null);
    try {
      await approveMemberClaim(groupId, memberId, adminToken);
      await onRefresh();
    } catch (err) {
      setActionError(getFriendlyErrorMessage(err));
    } finally {
      setActionLoadingId(null);
    }
  };

  const handleReset = async (memberId: string) => {
    setActionLoadingId(memberId);
    setActionError(null);
    try {
      await resetMemberClaim(groupId, memberId, adminToken);
      setResetConfirmId(null);
      await onRefresh();
    } catch (err) {
      setActionError(getFriendlyErrorMessage(err));
    } finally {
      setActionLoadingId(null);
    }
  };

  const handleToggleActive = async (m: GroupMember) => {
    setActionLoadingId(m.id);
    setActionError(null);
    try {
      await updateMember(groupId, m.id, adminToken, {
        is_active: !m.is_active,
      });
      await onRefresh();
    } catch (err) {
      setActionError(getFriendlyErrorMessage(err));
    } finally {
      setActionLoadingId(null);
    }
  };

  const handleQuickAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    const names = quickAddText
      .split('\n')
      .map((n) => n.trim())
      .filter(Boolean);

    if (names.length === 0) {
      setQuickAddError('Please enter at least one name.');
      return;
    }

    setQuickAddLoading(true);
    setQuickAddError(null);

    try {
      await addMembers(groupId, adminToken, names);
      setQuickAddText('');
      setShowQuickAdd(false);
      await onRefresh();
    } catch (err) {
      setQuickAddError(getFriendlyErrorMessage(err));
    } finally {
      setQuickAddLoading(false);
    }
  };

  const renderStatusBadge = (m: GroupMember) => {
    if (!m.is_active) {
      return <Badge status="inactive" label="Inactive" />;
    }
    if (m.claim_status === 'pending') {
      return <Badge status="waiting" label="Waiting for approval" />;
    }
    if (m.claim_status === 'approved') {
      return <Badge status="claimed" label="Claimed" />;
    }
    return <Badge status="not_claimed" label="Not claimed" />;
  };

  return (
    <div className="space-y-6">
      {actionError && <Banner type="error">{actionError}</Banner>}

      {/* Header with Search, Filter & Action Buttons */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
        <div className="flex items-center gap-2 flex-1">
          <input
            type="search"
            placeholder="Search by name, identifier, or value..."
            value={searchQuery}
            onChange={(e) => {
              setSearchQuery(e.target.value);
              setCurrentPage(1);
            }}
            className="w-full max-w-sm px-3.5 py-2 text-sm border border-neutral-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-600 bg-white"
          />

          <select
            value={statusFilter}
            onChange={(e) => {
              setStatusFilter(e.target.value);
              setCurrentPage(1);
            }}
            className="px-3 py-2 text-sm border border-neutral-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-600 bg-white min-w-[150px]"
          >
            <option value="all">All statuses</option>
            <option value="waiting">Waiting for approval</option>
            <option value="claimed">Claimed</option>
            <option value="not_claimed">Not claimed</option>
            <option value="inactive">Inactive</option>
          </select>
        </div>

        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="secondary"
            onClick={() => setShowQuickAdd((prev) => !prev)}
          >
            Quick add names
          </Button>
          <Button size="sm" variant="primary" onClick={handleOpenAdd}>
            Add member
          </Button>
        </div>
      </div>

      {/* Quick Add Section */}
      {showQuickAdd && (
        <Card className="space-y-3 bg-neutral-50/70 border border-neutral-200">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-bold uppercase tracking-wider text-neutral-800">
              Quick Add by Name
            </h3>
            <button
              type="button"
              onClick={() => setShowQuickAdd(false)}
              className="text-xs text-neutral-500 hover:text-neutral-800"
            >
              Close
            </button>
          </div>

          <p className="text-xs text-neutral-500">
            Enter member names one per line. Default field values will be assigned automatically.
          </p>

          {quickAddError && <Banner type="error">{quickAddError}</Banner>}

          <form onSubmit={handleQuickAdd} className="space-y-3">
            <textarea
              rows={3}
              placeholder="Alice Smith&#10;Bob Jones&#10;Charlie Brown"
              value={quickAddText}
              onChange={(e) => setQuickAddText(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-neutral-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-600 bg-white"
            />
            <div className="flex gap-2">
              <Button type="submit" size="sm" variant="primary" loading={quickAddLoading}>
                Add Names
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => setShowQuickAdd(false)}
                disabled={quickAddLoading}
              >
                Cancel
              </Button>
            </div>
          </form>
        </Card>
      )}

      {/* Pagination Status Line */}
      <div className="flex items-center justify-between text-xs text-neutral-500 px-1">
        <span>
          {paged.total === 0
            ? 'No members found'
            : `Showing ${paged.start} to ${paged.end} of ${paged.total}`}
        </span>

        {paged.totalPages > 1 && (
          <div className="flex items-center gap-1.5">
            <Button
              size="sm"
              variant="ghost"
              disabled={paged.page <= 1}
              onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
            >
              Previous
            </Button>
            <span>
              Page {paged.page} of {paged.totalPages}
            </span>
            <Button
              size="sm"
              variant="ghost"
              disabled={paged.page >= paged.totalPages}
              onClick={() => setCurrentPage((p) => Math.min(paged.totalPages, p + 1))}
            >
              Next
            </Button>
          </div>
        )}
      </div>

      {/* Desktop Table View (>= 768px) */}
      <div className="hidden md:block bg-white rounded-2xl border border-neutral-200/80 shadow-xs overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm border-collapse">
            <thead className="bg-neutral-50/80 border-b border-neutral-200 text-xs font-semibold text-neutral-600">
              <tr>
                <th className="py-3 px-4 sticky left-0 bg-neutral-50/95 z-10 shadow-xs">Name</th>
                {identifierField && (
                  <th className="py-3 px-4 font-semibold text-indigo-900 bg-indigo-50/30">
                    {identifierField.name}
                  </th>
                )}
                {otherFields.map((f) => (
                  <th key={f.id} className="py-3 px-4 font-normal">
                    {f.name}
                  </th>
                ))}
                <th className="py-3 px-4">Status</th>
                <th className="py-3 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100">
              {paged.items.length === 0 ? (
                <tr>
                  <td
                    colSpan={3 + (identifierField ? 1 : 0) + otherFields.length}
                    className="py-8 text-center text-neutral-500 text-sm"
                  >
                    No members match your search or filter.
                  </td>
                </tr>
              ) : (
                paged.items.map((m) => {
                  const isResetting = resetConfirmId === m.id;
                  const isLoading = actionLoadingId === m.id;
                  const identifierVal = identifierField
                    ? m.values?.[identifierField.key] ?? m.identifier ?? '-'
                    : null;

                  return (
                    <tr
                      key={m.id}
                      className={`hover:bg-neutral-50/60 transition-colors ${
                        !m.is_active ? 'opacity-60 bg-neutral-50/30' : ''
                      }`}
                    >
                      {/* Sticky Name column */}
                      <td className="py-3 px-4 sticky left-0 bg-white z-10 font-medium text-neutral-900 border-r border-neutral-100 shadow-xs">
                        {m.display_name}
                      </td>

                      {/* Identifier Column */}
                      {identifierField && (
                        <td className="py-3 px-4 font-mono text-xs text-neutral-700 bg-indigo-50/10">
                          {String(identifierVal)}
                        </td>
                      )}

                      {/* Other Fields */}
                      {otherFields.map((f) => {
                        const val = m.values?.[f.key];
                        return (
                          <td key={f.id} className="py-3 px-4 text-neutral-600 text-xs">
                            {val !== undefined && val !== null && val !== ''
                              ? String(val)
                              : '-'}
                          </td>
                        );
                      })}

                      {/* Status */}
                      <td className="py-3 px-4">{renderStatusBadge(m)}</td>

                      {/* Actions */}
                      <td className="py-3 px-4 text-right">
                        {isResetting ? (
                          <div className="inline-flex items-center gap-1.5 p-1 bg-amber-50 border border-amber-200 rounded-lg text-xs">
                            <span className="text-amber-900 font-medium text-[11px]">
                              Reset claim?
                            </span>
                            <Button
                              size="sm"
                              variant="danger"
                              loading={isLoading}
                              onClick={() => handleReset(m.id)}
                            >
                              Confirm
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => setResetConfirmId(null)}
                            >
                              Cancel
                            </Button>
                          </div>
                        ) : (
                          <div className="inline-flex items-center gap-1">
                            {/* Approve: only for waiting/pending */}
                            {m.is_active && m.claim_status === 'pending' && (
                              <Button
                                size="sm"
                                variant="primary"
                                loading={isLoading}
                                onClick={() => handleApprove(m.id)}
                              >
                                Approve
                              </Button>
                            )}

                            {/* Reset: only for waiting or claimed */}
                            {(m.claim_status === 'pending' || m.claim_status === 'approved') && (
                              <Button
                                size="sm"
                                variant="secondary"
                                disabled={isLoading}
                                onClick={() => setResetConfirmId(m.id)}
                              >
                                Reset
                              </Button>
                            )}

                            <Button
                              size="sm"
                              variant="ghost"
                              disabled={isLoading}
                              onClick={() => handleOpenEdit(m)}
                            >
                              Edit
                            </Button>

                            <Button
                              size="sm"
                              variant="ghost"
                              disabled={isLoading}
                              onClick={() => handleToggleActive(m)}
                            >
                              {m.is_active ? 'Deactivate' : 'Reactivate'}
                            </Button>
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Mobile Card View (< 768px) */}
      <div className="block md:hidden space-y-3">
        {paged.items.length === 0 ? (
          <Card className="text-center py-6 text-sm text-neutral-500">
            No members match your search or filter.
          </Card>
        ) : (
          paged.items.map((m) => {
            const isResetting = resetConfirmId === m.id;
            const isLoading = actionLoadingId === m.id;
            const isExpanded = Boolean(expandedMemberIds[m.id]);
            const identifierVal = identifierField
              ? m.values?.[identifierField.key] ?? m.identifier ?? '-'
              : null;

            return (
              <Card
                key={m.id}
                className={`p-4 space-y-3 ${!m.is_active ? 'opacity-60' : ''}`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="space-y-0.5">
                    <span className="font-semibold text-sm text-neutral-900 block">
                      {m.display_name}
                    </span>
                    {identifierField && (
                      <span className="text-xs text-neutral-500 font-mono block">
                        {identifierField.name}: {String(identifierVal)}
                      </span>
                    )}
                  </div>
                  <div>{renderStatusBadge(m)}</div>
                </div>

                {/* Details Accordion Toggle */}
                {otherFields.length > 0 && (
                  <div>
                    <button
                      type="button"
                      onClick={() => toggleDetails(m.id)}
                      className="text-xs text-indigo-600 hover:text-indigo-800 font-medium inline-flex items-center gap-1"
                    >
                      {isExpanded ? 'Hide Details' : 'Details'}
                      <svg
                        className={`w-3.5 h-3.5 transition-transform ${isExpanded ? 'rotate-180' : ''}`}
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                      </svg>
                    </button>

                    {isExpanded && (
                      <div className="mt-2 pt-2 border-t border-neutral-100 space-y-1 text-xs text-neutral-600">
                        {otherFields.map((f) => (
                          <div key={f.id} className="flex justify-between py-0.5">
                            <span className="text-neutral-500">{f.name}:</span>
                            <span className="font-medium text-neutral-800">
                              {m.values?.[f.key] !== undefined &&
                              m.values?.[f.key] !== null &&
                              m.values?.[f.key] !== ''
                                ? String(m.values[f.key])
                                : '-'}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {/* Actions Row */}
                {isResetting ? (
                  <div className="p-2.5 bg-amber-50 border border-amber-200 rounded-xl space-y-2 text-xs text-amber-950">
                    <p className="font-medium">
                      Reset claim? The next person to claim this name will keep its previous votes and history.
                    </p>
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        variant="danger"
                        loading={isLoading}
                        onClick={() => handleReset(m.id)}
                      >
                        Confirm Reset
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setResetConfirmId(null)}
                      >
                        Cancel
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center gap-1.5 pt-1 flex-wrap">
                    {m.is_active && m.claim_status === 'pending' && (
                      <Button
                        size="sm"
                        variant="primary"
                        loading={isLoading}
                        onClick={() => handleApprove(m.id)}
                      >
                        Approve
                      </Button>
                    )}

                    {(m.claim_status === 'pending' || m.claim_status === 'approved') && (
                      <Button
                        size="sm"
                        variant="secondary"
                        disabled={isLoading}
                        onClick={() => setResetConfirmId(m.id)}
                      >
                        Reset
                      </Button>
                    )}

                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={isLoading}
                      onClick={() => handleOpenEdit(m)}
                    >
                      Edit
                    </Button>

                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={isLoading}
                      onClick={() => handleToggleActive(m)}
                    >
                      {m.is_active ? 'Deactivate' : 'Reactivate'}
                    </Button>
                  </div>
                )}
              </Card>
            );
          })
        )}
      </div>

      {/* Member Form Modal */}
      <MemberModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        fields={fields}
        member={editingMember}
        onSave={handleSaveMember}
      />
    </div>
  );
};
