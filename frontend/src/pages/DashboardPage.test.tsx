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
}));

describe('DashboardPage', () => {
  const mockGroup: AdminGroupDetailResponse = {
    id: 'grp-test',
    name: 'Weekend Football',
    join_code: 'code123',
    require_claim_approval: false,
    allow_name_list: false,
    fields: [
      {
        id: 'f-reg',
        key: 'reg_no',
        name: 'Register No',
        field_type: 'text',
        is_required: true,
        default_value: null,
        choices: null,
        is_identifier: true,
        position: 1,
      },
    ],
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

  it('shows the roster summary and the waiting-for-approval badge, plus identifier hint line', async () => {
    saveAdmin('grp-test', { adminToken: 'token-xyz', groupName: 'Weekend Football' });
    vi.mocked(endpoints.getGroup).mockResolvedValue(mockGroup);
    vi.mocked(endpoints.getGroupPolls).mockResolvedValue(mockPolls);

    renderDashboard('grp-test');

    await waitFor(() => {
      expect(screen.getByText('Weekend Football')).toBeInTheDocument();
      expect(screen.getByRole('heading', { name: /^Roster$/i })).toBeInTheDocument();
      expect(screen.getByText(/3 members/i)).toBeInTheDocument();
      expect(screen.getByText(/1 field/i)).toBeInTheDocument();
      expect(screen.getByText(/1 waiting for approval/i)).toBeInTheDocument();
      expect(screen.getByRole('link', { name: /Manage roster/i })).toHaveAttribute(
        'href',
        '/g/grp-test/roster',
      );
      expect(
        screen.getByText('Members claim their name by entering their Register No.'),
      ).toBeInTheDocument();
    });
  });

  it('toggling the "Show the list of names" switch calls updateGroup PATCH with allow_name_list', async () => {
    saveAdmin('grp-test', { adminToken: 'token-xyz', groupName: 'Weekend Football' });
    vi.mocked(endpoints.getGroup).mockResolvedValue(mockGroup);
    vi.mocked(endpoints.getGroupPolls).mockResolvedValue(mockPolls);
    vi.mocked(endpoints.updateGroup).mockResolvedValue({
      ...mockGroup,
      allow_name_list: true,
    });

    renderDashboard('grp-test');

    await waitFor(() => {
      expect(screen.getByText('Weekend Football')).toBeInTheDocument();
    });

    const checkbox = screen.getByRole('checkbox', {
      name: /Show the list of names on the join page/i,
    });
    expect(checkbox).not.toBeChecked();

    await userEvent.click(checkbox);
    expect(endpoints.updateGroup).toHaveBeenCalledWith('grp-test', 'token-xyz', {
      allow_name_list: true,
    });
  });

  it('toggling the approval switch calls updateGroup PATCH with require_claim_approval', async () => {
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
