import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { JoinPage } from './JoinPage';
import * as endpoints from '../api/endpoints';
import { ApiError } from '../api/client';
import {
  _clearMemoryStore,
  clearMemberIdentity,
  getMemberIdentity,
  saveMemberIdentity,
} from '../lib/storage';
import type { JoinGroupResponse } from '../api/types';

vi.mock('../api/endpoints', () => ({
  getJoinInfo: vi.fn(),
  claimMember: vi.fn(),
  getMe: vi.fn(),
  getMyPolls: vi.fn(),
  releaseClaim: vi.fn(),
}));

describe('JoinPage', () => {
  const mockGroup: JoinGroupResponse = {
    group_id: 'grp-1',
    group_name: 'Weekend Football',
    members: [
      { id: 'mem-1', display_name: 'Alice', taken: false },
      { id: 'mem-2', display_name: 'Bob (Taken)', taken: true },
    ],
  };

  beforeEach(() => {
    localStorage.clear();
    _clearMemoryStore();
    vi.clearAllMocks();
  });

  const renderJoinPage = (code = 'team123') => {
    return render(
      <MemoryRouter initialEntries={[`/join/${code}`]}>
        <Routes>
          <Route path="/join/:joinCode" element={<JoinPage />} />
        </Routes>
      </MemoryRouter>,
    );
  };

  it('renders member names, disables taken names, and allows claiming an available name', async () => {
    vi.mocked(endpoints.getJoinInfo).mockResolvedValue(mockGroup);
    vi.mocked(endpoints.claimMember).mockResolvedValue({
      member_id: 'mem-1',
      member_token: 'secret-token-alice',
      status: 'approved',
    });
    vi.mocked(endpoints.getMyPolls).mockResolvedValue([
      { id: 'poll-1', name: 'Saturday Match', status: 'open', deadline: null },
    ]);

    renderJoinPage('team123');

    // Wait for group data to load
    await waitFor(() => {
      expect(screen.getByText('Weekend Football')).toBeInTheDocument();
    });

    // Check taken member button
    const bobBtn = screen.getByRole('button', { name: /Bob \(Taken\)/i });
    expect(bobBtn).toBeDisabled();
    expect(
      screen.getByText(/Already taken\. If that is you on a new phone/i),
    ).toBeInTheDocument();

    // Check available member button
    const aliceBtn = screen.getByRole('button', { name: /Alice/i });
    expect(aliceBtn).not.toBeDisabled();

    // Select Alice
    await userEvent.click(aliceBtn);

    // Confirmation appears
    expect(screen.getByText(/This is me:/i)).toBeInTheDocument();
    expect(screen.getAllByText('Alice').length).toBeGreaterThanOrEqual(1);

    const confirmBtn = screen.getByRole('button', { name: /^Confirm$/i });
    await userEvent.click(confirmBtn);

    // Verify claimMember was called with correct parameters
    await waitFor(() => {
      expect(endpoints.claimMember).toHaveBeenCalledWith('team123', 'mem-1');
    });

    // Verify identity was stored in storage
    const stored = getMemberIdentity('team123');
    expect(stored).toEqual({
      memberToken: 'secret-token-alice',
      memberId: 'mem-1',
      displayName: 'Alice',
    });

    // Verify approved state is shown
    await waitFor(() => {
      expect(screen.getByText(/Recognized Member/i)).toBeInTheDocument();
      expect(screen.getByText('Saturday Match')).toBeInTheDocument();
    });
  });

  // 1. A claim that fails with name_already_claimed reloads the list, clears the selection,
  //    shows the "was just taken" message, and the name is disabled.
  it('a claim that fails with name_already_claimed reloads the list, clears the selection, shows the "was just taken" message, and the name is disabled', async () => {
    vi.mocked(endpoints.getJoinInfo).mockResolvedValueOnce(mockGroup);
    vi.mocked(endpoints.claimMember).mockRejectedValueOnce(
      new ApiError(409, 'name_already_claimed', 'Member is already claimed.'),
    );
    // After reload, Alice is now taken
    const updatedGroup: JoinGroupResponse = {
      ...mockGroup,
      members: [
        { id: 'mem-1', display_name: 'Alice', taken: true },
        { id: 'mem-2', display_name: 'Bob (Taken)', taken: true },
      ],
    };
    vi.mocked(endpoints.getJoinInfo).mockResolvedValueOnce(updatedGroup);

    renderJoinPage('team123');

    await waitFor(() => {
      expect(screen.getByText('Weekend Football')).toBeInTheDocument();
    });

    const aliceBtn = screen.getByRole('button', { name: /Alice/i });
    expect(aliceBtn).not.toBeDisabled();
    await userEvent.click(aliceBtn);

    expect(screen.getByText(/This is me:/i)).toBeInTheDocument();

    const confirmBtn = screen.getByRole('button', { name: /^Confirm$/i });
    await userEvent.click(confirmBtn);

    // Conflict error message is displayed
    await waitFor(() => {
      expect(
        screen.getByText('Alice was just taken by someone else. Please pick another name.'),
      ).toBeInTheDocument();
    });

    // getJoinInfo was called again to reload
    expect(endpoints.getJoinInfo).toHaveBeenCalledTimes(2);

    // Selection is cleared ("This is me: Alice" is gone)
    expect(screen.queryByText(/This is me:/i)).not.toBeInTheDocument();

    // Alice is now disabled (taken)
    const disabledAliceBtn = screen.getByRole('button', { name: /Alice/i });
    expect(disabledAliceBtn).toBeDisabled();
  });

  // 2. With an identity already stored for the join code, confirming a name does not call the
  //    claim endpoint and shows the recognised view.
  it('with an identity already stored for the join code, confirming a name does not call the claim endpoint and shows the recognised view', async () => {
    vi.mocked(endpoints.getJoinInfo).mockResolvedValue(mockGroup);
    vi.mocked(endpoints.getMe).mockResolvedValue({
      member_id: 'mem-2',
      display_name: 'Bob',
      group_id: 'grp-1',
      group_name: 'Weekend Football',
      claim_status: 'approved',
    });
    vi.mocked(endpoints.getMyPolls).mockResolvedValue([]);

    renderJoinPage('team123');

    await waitFor(() => {
      expect(screen.getByText('Weekend Football')).toBeInTheDocument();
    });

    const aliceBtn = screen.getByRole('button', { name: /Alice/i });
    await userEvent.click(aliceBtn);
    expect(screen.getByText(/This is me:/i)).toBeInTheDocument();

    // Another tab claimed in the meantime, storing Bob's identity
    saveMemberIdentity('team123', {
      memberToken: 'bob-tab-token',
      memberId: 'mem-2',
      displayName: 'Bob',
    });

    const confirmBtn = screen.getByRole('button', { name: /^Confirm$/i });
    await userEvent.click(confirmBtn);

    // Claim endpoint was NOT called!
    expect(endpoints.claimMember).not.toHaveBeenCalled();

    // Recognised view for Bob is shown with note
    await waitFor(() => {
      expect(screen.getByText('This browser is already signed in as Bob.')).toBeInTheDocument();
      expect(screen.getByText(/Recognized Member/i)).toBeInTheDocument();
      expect(screen.getByText(/You are/i)).toHaveTextContent('Bob');
    });
  });

  // 3. A storage event for the group's key switches the page to the recognised view
  //    (identity added in another tab), and back to the claim list (identity removed).
  it('a storage event for the group key switches the page to the recognised view (identity added in another tab), and back to the claim list (identity removed)', async () => {
    vi.mocked(endpoints.getJoinInfo).mockResolvedValue(mockGroup);
    vi.mocked(endpoints.getMe).mockResolvedValue({
      member_id: 'mem-1',
      display_name: 'Alice',
      group_id: 'grp-1',
      group_name: 'Weekend Football',
      claim_status: 'approved',
    });
    vi.mocked(endpoints.getMyPolls).mockResolvedValue([]);

    renderJoinPage('team123');

    await waitFor(() => {
      expect(screen.getByText('Choose your name')).toBeInTheDocument();
    });

    // Identity added in another tab
    saveMemberIdentity('team123', {
      memberToken: 'alice-tab-token',
      memberId: 'mem-1',
      displayName: 'Alice',
    });
    act(() => {
      window.dispatchEvent(new StorageEvent('storage', { key: 'pollapp.member.team123' }));
    });

    // Page switches to recognised view
    await waitFor(() => {
      expect(screen.getByText(/Recognized Member/i)).toBeInTheDocument();
      expect(screen.getByText(/You are/i)).toHaveTextContent('Alice');
    });

    // Identity removed in another tab
    clearMemberIdentity('team123');
    act(() => {
      window.dispatchEvent(new StorageEvent('storage', { key: 'pollapp.member.team123' }));
    });

    // Page switches back to claim list
    await waitFor(() => {
      expect(screen.getByText('Choose your name')).toBeInTheDocument();
    });
  });

  // 4. "Not you? Switch name" asks for confirmation, calls the release endpoint,
  //    clears the stored identity and shows the claim list; it does nothing if the confirmation is cancelled.
  it('"Not you? Switch name" asks for confirmation, calls the release endpoint, clears the stored identity and shows the claim list; it does nothing if the confirmation is cancelled', async () => {
    saveMemberIdentity('team123', {
      memberToken: 'tok-alice',
      memberId: 'mem-1',
      displayName: 'Alice',
    });
    vi.mocked(endpoints.getJoinInfo).mockResolvedValue(mockGroup);
    vi.mocked(endpoints.getMe).mockResolvedValue({
      member_id: 'mem-1',
      display_name: 'Alice',
      group_id: 'grp-1',
      group_name: 'Weekend Football',
      claim_status: 'approved',
    });
    vi.mocked(endpoints.getMyPolls).mockResolvedValue([]);
    vi.mocked(endpoints.releaseClaim).mockResolvedValue({ status: 'unclaimed' });

    renderJoinPage('team123');

    await waitFor(() => {
      expect(screen.getByText(/Recognized Member/i)).toBeInTheDocument();
    });

    // Click "Not you? Switch name"
    const switchBtn = screen.getByRole('button', { name: /Not you\? Switch name/i });
    await userEvent.click(switchBtn);

    // Confirmation text appears
    expect(
      screen.getByText(
        'This frees the name Alice so you or someone else can claim it again. Votes already made stay with that name.',
      ),
    ).toBeInTheDocument();

    // Cancel first
    const cancelBtn = screen.getByRole('button', { name: /^Cancel$/i });
    await userEvent.click(cancelBtn);

    expect(endpoints.releaseClaim).not.toHaveBeenCalled();
    expect(getMemberIdentity('team123')).not.toBeNull();
    expect(screen.getByText(/Recognized Member/i)).toBeInTheDocument();

    // Click again and confirm
    await userEvent.click(screen.getByRole('button', { name: /Not you\? Switch name/i }));
    const confirmSwitchBtn = screen.getByRole('button', { name: /Confirm switch/i });
    await userEvent.click(confirmSwitchBtn);

    // releaseClaim called with memberToken
    await waitFor(() => {
      expect(endpoints.releaseClaim).toHaveBeenCalledWith('tok-alice');
    });

    // Identity cleared
    expect(getMemberIdentity('team123')).toBeNull();

    // Claim list is shown
    await waitFor(() => {
      expect(screen.getByText('Choose your name')).toBeInTheDocument();
    });
  });

  // 5. A 401 from the release call still clears the local identity; a network error keeps it and shows the error.
  it('a 401 from the release call still clears the local identity; a network error keeps it and shows the error', async () => {
    saveMemberIdentity('team123', {
      memberToken: 'tok-alice',
      memberId: 'mem-1',
      displayName: 'Alice',
    });
    vi.mocked(endpoints.getJoinInfo).mockResolvedValue(mockGroup);
    vi.mocked(endpoints.getMe).mockResolvedValue({
      member_id: 'mem-1',
      display_name: 'Alice',
      group_id: 'grp-1',
      group_name: 'Weekend Football',
      claim_status: 'approved',
    });
    vi.mocked(endpoints.getMyPolls).mockResolvedValue([]);

    // 5a: Network error -> keeps identity and shows error
    vi.mocked(endpoints.releaseClaim).mockRejectedValueOnce(
      new ApiError(0, 'network_error', 'Network connection failed. Please check your internet connection.'),
    );

    renderJoinPage('team123');

    await waitFor(() => {
      expect(screen.getByText(/Recognized Member/i)).toBeInTheDocument();
    });

    await userEvent.click(screen.getByRole('button', { name: /Not you\? Switch name/i }));
    await userEvent.click(screen.getByRole('button', { name: /Confirm switch/i }));

    await waitFor(() => {
      expect(
        screen.getByText(/Could not connect to the server\. Please check your internet connection\./i),
      ).toBeInTheDocument();
    });
    expect(getMemberIdentity('team123')).not.toBeNull();
    expect(screen.getByText(/Recognized Member/i)).toBeInTheDocument();

    // 5b: 401 error -> creator already reset it, clears identity and shows claim list
    vi.mocked(endpoints.releaseClaim).mockRejectedValueOnce(
      new ApiError(401, 'invalid_token', 'Invalid member token.'),
    );

    await userEvent.click(screen.getByRole('button', { name: /Confirm switch/i }));

    await waitFor(() => {
      expect(getMemberIdentity('team123')).toBeNull();
      expect(screen.getByText('Choose your name')).toBeInTheDocument();
    });
  });

  // 6. Returning to the tab (visibilitychange to visible) reloads the member list while the claim list is showing.
  it('returning to the tab (visibilitychange to visible) reloads the member list while the claim list is showing', async () => {
    vi.mocked(endpoints.getJoinInfo).mockResolvedValue(mockGroup);

    renderJoinPage('team123');

    await waitFor(() => {
      expect(screen.getByText('Choose your name')).toBeInTheDocument();
    });
    expect(endpoints.getJoinInfo).toHaveBeenCalledTimes(1);

    // Hidden -> does not reload
    Object.defineProperty(document, 'visibilityState', {
      value: 'hidden',
      configurable: true,
    });
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    expect(endpoints.getJoinInfo).toHaveBeenCalledTimes(1);

    // Visible -> reloads member list
    Object.defineProperty(document, 'visibilityState', {
      value: 'visible',
      configurable: true,
    });
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });

    await waitFor(() => {
      expect(endpoints.getJoinInfo).toHaveBeenCalledTimes(2);
    });

    // Window focus -> also reloads member list
    act(() => {
      window.dispatchEvent(new Event('focus'));
    });
    await waitFor(() => {
      expect(endpoints.getJoinInfo).toHaveBeenCalledTimes(3);
    });
  });
});
