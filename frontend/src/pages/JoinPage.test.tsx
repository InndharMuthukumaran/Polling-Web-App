import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { JoinPage } from './JoinPage';
import * as endpoints from '../api/endpoints';
import { _clearMemoryStore, getMemberIdentity } from '../lib/storage';
import type { JoinGroupResponse } from '../api/types';

vi.mock('../api/endpoints', () => ({
  getJoinInfo: vi.fn(),
  claimMember: vi.fn(),
  getMe: vi.fn(),
  getMyPolls: vi.fn(),
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
});
