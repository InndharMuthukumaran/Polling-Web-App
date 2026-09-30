import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { HomePage } from './HomePage';
import * as endpoints from '../api/endpoints';
import { _clearAdminMemoryStore, getAdmin } from '../lib/adminStorage';

vi.mock('../api/endpoints', () => ({
  createGroup: vi.fn(),
  getGroup: vi.fn(),
}));

describe('HomePage', () => {
  beforeEach(() => {
    localStorage.clear();
    _clearAdminMemoryStore();
    vi.clearAllMocks();
  });

  const renderHomePage = () => {
    return render(
      <MemoryRouter initialEntries={['/']}>
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/g/:groupId" element={<div data-testid="dashboard-page">Dashboard</div>} />
        </Routes>
      </MemoryRouter>,
    );
  };

  it('creating a group saves admin data and keeps "Go to my group" disabled until checkbox is ticked', async () => {
    vi.mocked(endpoints.createGroup).mockResolvedValue({
      group_id: 'grp-xyz',
      name: 'Friday Meetup',
      join_code: 'meetup123',
      admin_token: 'secret-creator-token',
    });

    renderHomePage();

    // Fill in group name
    const input = screen.getByLabelText(/Group Name/i);
    await userEvent.type(input, 'Friday Meetup');

    // Click Create
    const createBtn = screen.getByRole('button', { name: /^Create$/i });
    await userEvent.click(createBtn);

    // Wait for reveal screen
    await waitFor(() => {
      expect(screen.getByText('Save your creator access')).toBeInTheDocument();
    });

    // Verify warning is present
    expect(
      screen.getByText(/This is the only time the token is shown/i),
    ).toBeInTheDocument();

    // Verify admin data is saved in storage
    const stored = getAdmin('grp-xyz');
    expect(stored).toEqual({
      adminToken: 'secret-creator-token',
      groupName: 'Friday Meetup',
    });

    // Check "Go to my group" button is initially disabled
    const goBtn = screen.getByRole('button', { name: /Go to my group/i });
    expect(goBtn).toBeDisabled();

    // Tick the checkbox "I have saved it"
    const checkbox = screen.getByRole('checkbox', { name: /I have saved it/i });
    await userEvent.click(checkbox);

    // "Go to my group" button is now enabled
    expect(goBtn).not.toBeDisabled();

    // Click "Go to my group"
    await userEvent.click(goBtn);

    // Navigates to dashboard
    await waitFor(() => {
      expect(screen.getByTestId('dashboard-page')).toBeInTheDocument();
    });
  });
});
