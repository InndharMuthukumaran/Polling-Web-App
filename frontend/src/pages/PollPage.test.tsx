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
  releaseClaim: vi.fn(),
  lookupIdentifier: vi.fn(),
  saveAnswers: vi.fn(),
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

  it('renders radio indicators for single-choice and checkbox indicators for multiple-choice', async () => {
    saveMemberIdentity('lunchcode', {
      memberToken: 'tok-alice',
      memberId: 'mem-1',
      displayName: 'Alice',
    });

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

    // 1. Single-choice poll (allow_multiple: false)
    vi.mocked(endpoints.getPublicPoll).mockResolvedValue({
      ...mockPoll,
      allow_multiple: false,
    });

    const { unmount } = renderPollPage('poll-123');

    await waitFor(() => {
      expect(screen.getByText('Pizza Place')).toBeInTheDocument();
    });

    expect(document.querySelectorAll('[data-indicator="radio"]').length).toBe(2);
    expect(document.querySelectorAll('[data-indicator="checkbox"]').length).toBe(0);

    unmount();

    // 2. Multiple-choice poll (allow_multiple: true)
    vi.mocked(endpoints.getPublicPoll).mockResolvedValue({
      ...mockPoll,
      allow_multiple: true,
    });

    renderPollPage('poll-123');

    await waitFor(() => {
      expect(screen.getByText('Pizza Place')).toBeInTheDocument();
    });

    expect(document.querySelectorAll('[data-indicator="checkbox"]').length).toBe(2);
    expect(document.querySelectorAll('[data-indicator="radio"]').length).toBe(0);
  });

  it('"Not you? Switch name" on PollPage asks for confirmation and releases claim', async () => {
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
    vi.mocked(endpoints.getJoinInfo).mockResolvedValue(mockGroup);
    vi.mocked(endpoints.releaseClaim).mockResolvedValue({ status: 'unclaimed' });

    renderPollPage('poll-123');

    await waitFor(() => {
      expect(screen.getByText('Voting as')).toBeInTheDocument();
      expect(screen.getByText('Alice')).toBeInTheDocument();
    });

    // Find and click "Not you? Switch name"
    const switchBtn = screen.getByRole('button', { name: /Not you\? Switch name/i });
    await userEvent.click(switchBtn);

    // Confirmation message appears
    expect(
      screen.getByText(
        'This frees the name Alice so you or someone else can claim it again. Votes already made stay with that name.',
      ),
    ).toBeInTheDocument();

    // Confirm switch
    const confirmBtn = screen.getByRole('button', { name: /Confirm switch/i });
    await userEvent.click(confirmBtn);

    await waitFor(() => {
      expect(endpoints.releaseClaim).toHaveBeenCalledWith('tok-alice');
    });

    expect(getMemberIdentity('lunchcode')).toBeNull();

    // Switched back to inline claim list
    await waitFor(() => {
      expect(screen.getByText('Choose your name')).toBeInTheDocument();
    });
  });

  it('poll-only fields: shows pre-filled defaults and saved answers; saving calls endpoint with every field', async () => {
    saveMemberIdentity('lunchcode', {
      memberToken: 'tok-alice',
      memberId: 'mem-1',
      displayName: 'Alice',
    });
    const pollWithFields: PublicPollResponse = {
      ...mockPoll,
      poll_fields: [
        {
          key: 'expected_ctc',
          name: 'Expected CTC',
          field_type: 'number',
          is_required: true,
          default_value: '12.5',
          choices: null,
          position: 1,
        },
        {
          key: 'location',
          name: 'Location',
          field_type: 'choice',
          is_required: false,
          default_value: 'Remote',
          choices: ['Bangalore', 'Remote'],
          position: 2,
        },
      ],
    };
    vi.mocked(endpoints.getPublicPoll).mockResolvedValue(pollWithFields);
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
      answers: {
        location: 'Bangalore',
      },
      answers_updated_at: '2026-10-08T10:00:00Z',
    });
    vi.mocked(endpoints.saveAnswers).mockResolvedValue({
      answers: {
        expected_ctc: 15,
        location: 'Remote',
      },
      answers_updated_at: '2026-10-08T11:00:00Z',
    });

    renderPollPage('poll-123');

    await waitFor(() => {
      expect(screen.getByText('Your details for this poll')).toBeInTheDocument();
    });

    const ctcInput = screen.getByLabelText(/Expected CTC/i);
    expect(ctcInput).toHaveValue('12.5');

    const locInput = screen.getByLabelText(/Location/i);
    expect(locInput).toHaveValue('Bangalore');

    await userEvent.clear(ctcInput);
    await userEvent.type(ctcInput, '15');
    await userEvent.selectOptions(locInput, 'Remote');

    const saveBtn = screen.getByRole('button', { name: /Save answers/i });
    await userEvent.click(saveBtn);

    expect(endpoints.saveAnswers).toHaveBeenCalledWith(
      'poll-123',
      {
        expected_ctc: 15,
        location: 'Remote',
      },
      'tok-alice',
    );

    await waitFor(() => {
      expect(screen.getByText(/Saved/i)).toBeInTheDocument();
    });
  });

  it('server validation details appear on the right field', async () => {
    saveMemberIdentity('lunchcode', {
      memberToken: 'tok-alice',
      memberId: 'mem-1',
      displayName: 'Alice',
    });
    const pollWithFields: PublicPollResponse = {
      ...mockPoll,
      poll_fields: [
        {
          key: 'expected_ctc',
          name: 'Expected CTC',
          field_type: 'number',
          is_required: true,
          default_value: null,
          choices: null,
          position: 1,
        },
      ],
    };
    vi.mocked(endpoints.getPublicPoll).mockResolvedValue(pollWithFields);
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
      answers: {},
      answers_updated_at: null,
    });
    vi.mocked(endpoints.saveAnswers).mockRejectedValue(
      new ApiError(422, 'validation_error', 'Invalid values', [
        { field: 'expected_ctc', message: 'Value must be at least 1.' },
      ]),
    );

    renderPollPage('poll-123');

    await waitFor(() => {
      expect(screen.getByText('Your details for this poll')).toBeInTheDocument();
    });

    const ctcInput = screen.getByLabelText(/Expected CTC/i);
    await userEvent.type(ctcInput, '0');

    await userEvent.click(screen.getByRole('button', { name: /Save answers/i }));

    await waitFor(() => {
      expect(screen.getByText('Value must be at least 1.')).toBeInTheDocument();
    });
  });

  it('closed poll renders answers read-only with no Save button', async () => {
    saveMemberIdentity('lunchcode', {
      memberToken: 'tok-alice',
      memberId: 'mem-1',
      displayName: 'Alice',
    });
    const closedPoll: PublicPollResponse = {
      ...mockPoll,
      status: 'closed',
      poll_fields: [
        {
          key: 'role',
          name: 'Role',
          field_type: 'text',
          is_required: false,
          default_value: 'Engineer',
          choices: null,
          position: 1,
        },
      ],
    };
    vi.mocked(endpoints.getPublicPoll).mockResolvedValue(closedPoll);
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
      answers: { role: 'Senior Engineer' },
      answers_updated_at: null,
    });

    renderPollPage('poll-123');

    await waitFor(() => {
      expect(screen.getByText('Your details for this poll')).toBeInTheDocument();
    });

    expect(screen.getByText('This poll is closed.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Save answers/i })).not.toBeInTheDocument();
    expect(screen.getByText('Senior Engineer')).toBeInTheDocument();
  });

  it('required-details note appears when incomplete and disappears once saved', async () => {
    saveMemberIdentity('lunchcode', {
      memberToken: 'tok-alice',
      memberId: 'mem-1',
      displayName: 'Alice',
    });
    const pollWithRequired: PublicPollResponse = {
      ...mockPoll,
      poll_fields: [
        {
          key: 'expected_ctc',
          name: 'Expected CTC',
          field_type: 'number',
          is_required: true,
          default_value: null,
          choices: null,
          position: 1,
        },
      ],
    };
    vi.mocked(endpoints.getPublicPoll).mockResolvedValue(pollWithRequired);
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
      answers: {},
      answers_updated_at: null,
    });
    vi.mocked(endpoints.saveAnswers).mockResolvedValue({
      answers: { expected_ctc: 20 },
      answers_updated_at: '2026-10-08T12:00:00Z',
    });

    renderPollPage('poll-123');

    await waitFor(() => {
      expect(
        screen.getByText(/Please fill in the required details so the poll creator has everything\./i),
      ).toBeInTheDocument();
    });

    const input = screen.getByLabelText(/Expected CTC/i);
    await userEvent.type(input, '20');
    await userEvent.click(screen.getByRole('button', { name: /Save answers/i }));

    await waitFor(() => {
      expect(
        screen.queryByText(/Please fill in the required details so the poll creator has everything\./i),
      ).not.toBeInTheDocument();
    });
  });

  it('a 401 from saveAnswers clears identity and returns to claim screen', async () => {
    saveMemberIdentity('lunchcode', {
      memberToken: 'tok-alice',
      memberId: 'mem-1',
      displayName: 'Alice',
    });
    const pollWithFields: PublicPollResponse = {
      ...mockPoll,
      poll_fields: [
        {
          key: 'notes',
          name: 'Notes',
          field_type: 'text',
          is_required: false,
          default_value: 'none',
          choices: null,
          position: 1,
        },
      ],
    };
    vi.mocked(endpoints.getPublicPoll).mockResolvedValue(pollWithFields);
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
      answers: {},
      answers_updated_at: null,
    });
    vi.mocked(endpoints.saveAnswers).mockRejectedValue(
      new ApiError(401, 'invalid_token', 'Invalid member token.'),
    );
    vi.mocked(endpoints.getJoinInfo).mockResolvedValue(mockGroup);

    renderPollPage('poll-123');

    await waitFor(() => {
      expect(screen.getByText('Your details for this poll')).toBeInTheDocument();
    });

    const input = screen.getByLabelText(/Notes/i);
    await userEvent.type(input, ' extra');
    await userEvent.click(screen.getByRole('button', { name: /Save answers/i }));

    await waitFor(() => {
      expect(getMemberIdentity('lunchcode')).toBeNull();
      expect(screen.getByText('Choose your name')).toBeInTheDocument();
    });
  });
});


