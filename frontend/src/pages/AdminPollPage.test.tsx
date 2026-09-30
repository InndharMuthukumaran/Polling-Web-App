import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { AdminPollPage } from './AdminPollPage';
import * as endpoints from '../api/endpoints';
import { _clearAdminMemoryStore, saveAdmin } from '../lib/adminStorage';
import type { AdminPollHistoryResponse, AdminPollStatusResponse } from '../api/types';

vi.mock('../api/endpoints', () => ({
  getAdminPollStatus: vi.fn(),
  getAdminPollHistory: vi.fn(),
  closePoll: vi.fn(),
}));

describe('AdminPollPage', () => {
  const mockStatus: AdminPollStatusResponse = {
    poll: {
      id: 'poll-123',
      name: 'Sprint Goal',
      status: 'open',
      allow_multiple: false,
      deadline: '2026-10-30T18:00:00Z',
      completion_time_mode: 'last',
    },
    counts: {
      total_active: 4,
      at_target: 1,
      behind_target: 1,
      excused: 1,
      not_voted: 1,
    },
    all_reached: false,
    at_target: [
      { member_id: 'm-1', display_name: 'Alice Done', completed_at: '2026-10-10T12:00:00Z', late: false },
    ],
    behind_target: [
      { member_id: 'm-2', display_name: 'Charlie Behind' },
    ],
    excused: [
      { member_id: 'm-3', display_name: 'Bob Excused' },
    ],
    not_voted: [
      { member_id: 'm-4', display_name: 'David NotVoted' },
    ],
  };

  const mockHistory: AdminPollHistoryResponse = [
    {
      member_id: 'm-1',
      display_name: 'Alice Done',
      history: [
        {
          option_id: 'opt-target',
          option_label: 'Target Reached',
          first_selected_at: '2026-10-10T12:00:00Z',
          last_selected_at: '2026-10-10T12:00:00Z',
          is_selected: true,
        },
      ],
    },
  ];

  beforeEach(() => {
    localStorage.clear();
    _clearAdminMemoryStore();
    vi.clearAllMocks();

    Object.assign(navigator, {
      clipboard: {
        writeText: vi.fn().mockResolvedValue(undefined),
      },
    });
  });

  const renderAdminPollPage = (gid = 'grp-123', pid = 'poll-123') => {
    return render(
      <MemoryRouter initialEntries={[`/g/${gid}/polls/${pid}`]}>
        <Routes>
          <Route path="/g/:groupId/polls/:pollId" element={<AdminPollPage />} />
        </Routes>
      </MemoryRouter>,
    );
  };

  it('shows lists and counts; "Copy defaulters" writes Not voted + Behind target to clipboard mock', async () => {
    saveAdmin('grp-123', { adminToken: 'tok-admin', groupName: 'Core Team' });
    vi.mocked(endpoints.getAdminPollStatus).mockResolvedValue(mockStatus);
    vi.mocked(endpoints.getAdminPollHistory).mockResolvedValue(mockHistory);

    renderAdminPollPage('grp-123', 'poll-123');

    await waitFor(() => {
      expect(screen.getByText('Sprint Goal')).toBeInTheDocument();
      expect(screen.getByText('Alice Done')).toBeInTheDocument();
      expect(screen.getByText('Charlie Behind')).toBeInTheDocument();
      expect(screen.getByText('Bob Excused')).toBeInTheDocument();
      expect(screen.getByText('David NotVoted')).toBeInTheDocument();
    });

    // Check counts
    expect(screen.getByText('Done')).toBeInTheDocument();
    expect(screen.getByText('Behind')).toBeInTheDocument();
    expect(screen.getByText('Excused')).toBeInTheDocument();
    expect(screen.getByText('Not voted')).toBeInTheDocument();

    // Check Copy defaulters button shows combined count (2)
    const copyDefaultersBtn = screen.getByRole('button', {
      name: /Copy defaulters \(2\)/i,
    });
    expect(copyDefaultersBtn).toBeInTheDocument();

    // Click "Copy defaulters (2)"
    await userEvent.click(copyDefaultersBtn);

    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
      'David NotVoted\nCharlie Behind',
    );
  });

  it('shows all-reached banner only when all_reached is true and poll is open', async () => {
    saveAdmin('grp-123', { adminToken: 'tok-admin', groupName: 'Core Team' });
    vi.mocked(endpoints.getAdminPollStatus).mockResolvedValue({
      ...mockStatus,
      all_reached: true,
      poll: {
        ...mockStatus.poll,
        status: 'open',
      },
    });
    vi.mocked(endpoints.getAdminPollHistory).mockResolvedValue(mockHistory);

    renderAdminPollPage('grp-123', 'poll-123');

    await waitFor(() => {
      expect(
        screen.getByText('Everyone has reached the target. Close the poll?'),
      ).toBeInTheDocument();
    });
  });

  it('close poll button asks for confirmation before calling endpoint', async () => {
    saveAdmin('grp-123', { adminToken: 'tok-admin', groupName: 'Core Team' });
    vi.mocked(endpoints.getAdminPollStatus).mockResolvedValue(mockStatus);
    vi.mocked(endpoints.getAdminPollHistory).mockResolvedValue(mockHistory);
    vi.mocked(endpoints.closePoll).mockResolvedValue({ status: 'closed' });

    renderAdminPollPage('grp-123', 'poll-123');

    await waitFor(() => {
      expect(screen.getByText('Sprint Goal')).toBeInTheDocument();
    });

    // Find and click Close Poll
    const closeBtn = screen.getByRole('button', { name: /^Close Poll$/i });
    await userEvent.click(closeBtn);

    // Confirmation message appears
    expect(
      screen.getByText(/Are you sure you want to close this poll\?/i),
    ).toBeInTheDocument();
    expect(endpoints.closePoll).not.toHaveBeenCalled();

    // Confirm close
    const confirmCloseBtn = screen.getByRole('button', {
      name: /Confirm & Close Poll/i,
    });
    await userEvent.click(confirmCloseBtn);

    expect(endpoints.closePoll).toHaveBeenCalledWith('poll-123', 'tok-admin');
  });
});
