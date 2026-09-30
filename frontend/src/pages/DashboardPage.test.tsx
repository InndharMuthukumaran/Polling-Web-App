import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { DashboardPage } from './DashboardPage';
import * as endpoints from '../api/endpoints';
import { ApiError } from '../api/client';
import { _clearAdminMemoryStore, saveAdmin } from '../lib/adminStorage';
import type { AdminGroupDetailResponse, AdminPollListItem } from '../api/types';

vi.mock('../api/endpoints', () => ({
  getGroup: vi.fn(),
  getGroupPolls: vi.fn(),
  updateGroup: vi.fn(),
  addMembers: vi.fn(),
  updateMember: vi.fn(),
  approveMemberClaim: vi.fn(),
  resetMemberClaim: vi.fn(),
}));

describe('DashboardPage', () => {
  const mockGroup: AdminGroupDetailResponse = {
    id: 'grp-test',
    name: 'Weekend Football',
    join_code: 'code123',
    require_claim_approval: false,
    members: [
      { id: 'mem-unclaimed', display_name: 'Alice Unclaimed', is_active: true, claim_status: 'unclaimed' },
      { id: 'mem-pending', display_name: 'Bob Pending', is_active: true, claim_status: 'pending' },
      { id: 'mem-approved', display_name: 'Charlie Claimed', is_active: true, claim_status: 'approved' },
    ],
  };

  const mockPolls: AdminPollListItem[] = [
    {
      id: 'poll-1',
      name: 'Saturday Match',
      status: 'open',
      deadline: '2026-10-25T14:00:00Z',
      created_at: '2026-10-01T10:00:00Z',
    },
  ];

  beforeEach(() => {
    localStorage.clear();
    _clearAdminMemoryStore();
    vi.clearAllMocks();
  });

  const renderDashboard = (gid = 'grp-test') => {
    return render(
      <MemoryRouter initialEntries={[`/g/${gid}`]}>
        <Routes>
          <Route path="/g/:groupId" element={<DashboardPage />} />
        </Routes>
      </MemoryRouter>,
    );
  };

  it('renders members with right badges and only right actions; Approve and Reset call endpoints', async () => {
    saveAdmin('grp-test', { adminToken: 'token-xyz', groupName: 'Weekend Football' });
    vi.mocked(endpoints.getGroup).mockResolvedValue(mockGroup);
    vi.mocked(endpoints.getGroupPolls).mockResolvedValue(mockPolls);
    vi.mocked(endpoints.approveMemberClaim).mockResolvedValue({ status: 'approved' });
    vi.mocked(endpoints.resetMemberClaim).mockResolvedValue({ status: 'unclaimed' });

    renderDashboard('grp-test');

    await waitFor(() => {
      expect(screen.getByText('Weekend Football')).toBeInTheDocument();
      expect(screen.getByText('Alice Unclaimed')).toBeInTheDocument();
      expect(screen.getByText('Bob Pending')).toBeInTheDocument();
      expect(screen.getByText('Charlie Claimed')).toBeInTheDocument();
    });

    // Check badges
    expect(screen.getByText('Not claimed')).toBeInTheDocument();
    expect(screen.getByText('Waiting for approval')).toBeInTheDocument();
    expect(screen.getByText('Claimed')).toBeInTheDocument();

    // Bob (pending) has Approve and Reset
    // Charlie (approved) has Reset (no Approve)
    // Alice (unclaimed) has neither Approve nor Reset
    const approveButtons = screen.getAllByRole('button', { name: /^Approve$/i });
    expect(approveButtons).toHaveLength(1); // Only for Bob

    const resetButtons = screen.getAllByRole('button', { name: /^Reset$/i });
    expect(resetButtons).toHaveLength(2); // For Bob and Charlie

    // Click Approve on Bob
    await userEvent.click(approveButtons[0]);
    expect(endpoints.approveMemberClaim).toHaveBeenCalledWith('grp-test', 'mem-pending', 'token-xyz');

    // Click Reset on Charlie
    await userEvent.click(resetButtons[1]);
    expect(screen.getByText(/Reset claim\?/i)).toBeInTheDocument();

    const confirmResetBtn = screen.getByRole('button', { name: /Confirm Reset/i });
    await userEvent.click(confirmResetBtn);
    expect(endpoints.resetMemberClaim).toHaveBeenCalledWith('grp-test', 'mem-approved', 'token-xyz');
  });

  it('toggling the approval switch calls updateGroup PATCH', async () => {
    saveAdmin('grp-test', { adminToken: 'token-xyz', groupName: 'Weekend Football' });
    vi.mocked(endpoints.getGroup).mockResolvedValue(mockGroup);
    vi.mocked(endpoints.getGroupPolls).mockResolvedValue(mockPolls);
    vi.mocked(endpoints.updateGroup).mockResolvedValue({
      ...mockGroup,
      require_claim_approval: true,
    });

    renderDashboard('grp-test');

    await waitFor(() => {
      expect(screen.getByText('Weekend Football')).toBeInTheDocument();
    });

    const checkbox = screen.getByRole('checkbox', {
      name: /Require my approval before a member can vote/i,
    });
    expect(checkbox).not.toBeChecked();

    await userEvent.click(checkbox);
    expect(endpoints.updateGroup).toHaveBeenCalledWith('grp-test', 'token-xyz', {
      require_claim_approval: true,
    });
  });

  it('a 401 from an admin call shows the "not valid on this device" message', async () => {
    saveAdmin('grp-test', { adminToken: 'invalid-token', groupName: 'Weekend Football' });
    vi.mocked(endpoints.getGroup).mockRejectedValue(
      new ApiError(401, 'invalid_token', 'Invalid token'),
    );
    vi.mocked(endpoints.getGroupPolls).mockResolvedValue([]);

    renderDashboard('grp-test');

    await waitFor(() => {
      expect(
        screen.getByText('Your creator access for this group is not valid on this device.'),
      ).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Reconnect Group/i })).toBeInTheDocument();
    });
  });
});
