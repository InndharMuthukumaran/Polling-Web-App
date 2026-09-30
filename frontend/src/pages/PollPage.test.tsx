import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { PollPage } from './PollPage';
import * as endpoints from '../api/endpoints';
import { ApiError } from '../api/client';
import {
  _clearMemoryStore,
  getMemberIdentity,
  saveMemberIdentity,
} from '../lib/storage';
import type { JoinGroupResponse, PublicPollResponse } from '../api/types';

vi.mock('../api/endpoints', () => ({
  getPublicPoll: vi.fn(),
  getJoinInfo: vi.fn(),
  claimMember: vi.fn(),
  getMe: vi.fn(),
  getMyPolls: vi.fn(),
  castVote: vi.fn(),
  deleteVote: vi.fn(),
  getMyPollHistory: vi.fn(),
}));

describe('PollPage', () => {
  const mockPoll: PublicPollResponse = {
    id: 'poll-123',
    name: 'Team Lunch',
    description_raw: 'Where should we eat?',
    status: 'open',
    allow_multiple: false,
    deadline: '2026-12-31T12:00:00Z',
    options: [
      { id: 'opt-pizza', label: 'Pizza Place', position: 0 },
      { id: 'opt-sushi', label: 'Sushi Spot', position: 1 },
    ],
    group_name: 'Engineers',
    join_code: 'lunchcode',
  };

  const mockGroup: JoinGroupResponse = {
    group_id: 'grp-1',
    group_name: 'Engineers',
    members: [
      { id: 'mem-1', display_name: 'Alice', taken: false },
      { id: 'mem-2', display_name: 'Bob', taken: false },
    ],
  };

  beforeEach(() => {
    localStorage.clear();
    _clearMemoryStore();
    vi.clearAllMocks();
  });

  const renderPollPage = (pollId = 'poll-123') => {
    return render(
      <MemoryRouter initialEntries={[`/p/${pollId}`]}>
        <Routes>
          <Route path="/p/:pollId" element={<PollPage />} />
        </Routes>
      </MemoryRouter>,
    );
  };

  it('no stored identity shows the claim list inline', async () => {
    vi.mocked(endpoints.getPublicPoll).mockResolvedValue(mockPoll);
    vi.mocked(endpoints.getJoinInfo).mockResolvedValue(mockGroup);

    renderPollPage('poll-123');

    // Shows poll title and group name
    await waitFor(() => {
      expect(screen.getByText('Team Lunch')).toBeInTheDocument();
      expect(screen.getByText('Engineers')).toBeInTheDocument();
    });

    // Shows inline claiming options
    expect(screen.getByText('Step 1 of 2')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Alice/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Bob/i })).toBeInTheDocument();
  });

  it('an approved member sees options and tapping one calls the vote endpoint with the right IDs', async () => {
    saveMemberIdentity('lunchcode', {
      memberToken: 'tok-alice',
      memberId: 'mem-1',
      displayName: 'Alice',
    });

    vi.mocked(endpoints.getPublicPoll).mockResolvedValue(mockPoll);
    vi.mocked(endpoints.getMe).mockResolvedValue({
      member_id: 'mem-1',
      display_name: 'Alice',
      group_id: 'grp-1',
      group_name: 'Engineers',
      claim_status: 'approved',
    });
    vi.mocked(endpoints.getMyPollHistory).mockResolvedValue({
      selected_option_ids: [],
      history: [],
    });
    vi.mocked(endpoints.castVote).mockResolvedValue({
      selected_option_ids: ['opt-pizza'],
    });

    renderPollPage('poll-123');

    // Wait for options to render
    await waitFor(() => {
      expect(screen.getByText('Pizza Place')).toBeInTheDocument();
      expect(screen.getByText('Sushi Spot')).toBeInTheDocument();
    });

    // Verify creator notice is present
    expect(
      screen.getByText(/The poll creator can see when you first and last selected each option\./i),
    ).toBeInTheDocument();

    // Click 'Pizza Place'
    const pizzaOptionBtn = screen.getByRole('button', { name: /Pizza Place/i });
    await userEvent.click(pizzaOptionBtn);

    // castVote was called
    expect(endpoints.castVote).toHaveBeenCalledWith('poll-123', 'opt-pizza', 'tok-alice');
  });

  it('tapping a selected option calls the delete endpoint', async () => {
    saveMemberIdentity('lunchcode', {
      memberToken: 'tok-alice',
      memberId: 'mem-1',
      displayName: 'Alice',
    });

    vi.mocked(endpoints.getPublicPoll).mockResolvedValue(mockPoll);
    vi.mocked(endpoints.getMe).mockResolvedValue({
      member_id: 'mem-1',
      display_name: 'Alice',
      group_id: 'grp-1',
      group_name: 'Engineers',
      claim_status: 'approved',
    });
    vi.mocked(endpoints.getMyPollHistory).mockResolvedValue({
      selected_option_ids: ['opt-pizza'],
      history: [
        {
          option_id: 'opt-pizza',
          option_label: 'Pizza Place',
          first_selected_at: '2026-10-10T10:00:00Z',
          last_selected_at: '2026-10-10T10:00:00Z',
          is_selected: true,
        },
      ],
    });
    vi.mocked(endpoints.deleteVote).mockResolvedValue({
      selected_option_ids: [],
    });

    renderPollPage('poll-123');

    // Wait for selected option to appear
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Pizza Place/i })).toBeInTheDocument();
    });

    const pizzaOptionBtn = screen.getByRole('button', { name: /Pizza Place/i });
    await userEvent.click(pizzaOptionBtn);

    // deleteVote was called with option_id
    expect(endpoints.deleteVote).toHaveBeenCalledWith('poll-123', 'tok-alice', 'opt-pizza');
  });

  it('a closed poll shows no voting controls and shows "This poll is closed"', async () => {
    saveMemberIdentity('lunchcode', {
      memberToken: 'tok-alice',
      memberId: 'mem-1',
      displayName: 'Alice',
    });

    vi.mocked(endpoints.getPublicPoll).mockResolvedValue({
      ...mockPoll,
      status: 'closed',
    });
    vi.mocked(endpoints.getMe).mockResolvedValue({
      member_id: 'mem-1',
      display_name: 'Alice',
      group_id: 'grp-1',
      group_name: 'Engineers',
      claim_status: 'approved',
    });
    vi.mocked(endpoints.getMyPollHistory).mockResolvedValue({
      selected_option_ids: ['opt-pizza'],
      history: [],
    });

    renderPollPage('poll-123');

    // Wait for banner
    await waitFor(() => {
      expect(screen.getByText('This poll is closed')).toBeInTheDocument();
    });

    // Voting buttons should not exist (options are read-only div elements)
    expect(screen.queryByRole('button', { name: /Pizza Place/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Sushi Spot/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Clear my vote/i })).not.toBeInTheDocument();
  });

  it('a pending member sees the waiting panel', async () => {
    saveMemberIdentity('lunchcode', {
      memberToken: 'tok-pending',
      memberId: 'mem-1',
      displayName: 'Alice',
    });

    vi.mocked(endpoints.getPublicPoll).mockResolvedValue(mockPoll);
    vi.mocked(endpoints.getMe).mockResolvedValue({
      member_id: 'mem-1',
      display_name: 'Alice',
      group_id: 'grp-1',
      group_name: 'Engineers',
      claim_status: 'pending',
    });

    renderPollPage('poll-123');

    await waitFor(() => {
      expect(
        screen.getByText(/Waiting for the group creator to approve you/i),
      ).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Check again/i })).toBeInTheDocument();
    });
  });

  it('a 401 from /me clears the stored identity and shows the claim list', async () => {
    saveMemberIdentity('lunchcode', {
      memberToken: 'tok-invalid',
      memberId: 'mem-1',
      displayName: 'Alice',
    });

    vi.mocked(endpoints.getPublicPoll).mockResolvedValue(mockPoll);
    vi.mocked(endpoints.getMe).mockRejectedValue(
      new ApiError(401, 'invalid_token', 'Invalid token'),
    );
    vi.mocked(endpoints.getJoinInfo).mockResolvedValue(mockGroup);

    renderPollPage('poll-123');

    await waitFor(() => {
      expect(screen.getByText('Step 1 of 2')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Alice/i })).toBeInTheDocument();
    });

    // Verify identity was removed from storage
    expect(getMemberIdentity('lunchcode')).toBeNull();
  });
});
