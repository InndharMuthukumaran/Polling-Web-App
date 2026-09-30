import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { NewPollPage } from './NewPollPage';
import * as endpoints from '../api/endpoints';
import { _clearAdminMemoryStore, saveAdmin } from '../lib/adminStorage';

vi.mock('../api/endpoints', () => ({
  createPoll: vi.fn(),
}));

describe('NewPollPage', () => {
  beforeEach(() => {
    localStorage.clear();
    _clearAdminMemoryStore();
    vi.clearAllMocks();
  });

  const renderNewPollPage = (gid = 'grp-abc') => {
    return render(
      <MemoryRouter initialEntries={[`/g/${gid}/polls/new`]}>
        <Routes>
          <Route path="/g/:groupId/polls/new" element={<NewPollPage />} />
          <Route
            path="/g/:groupId/polls/:pollId"
            element={<div data-testid="poll-admin-page">Admin Poll Page</div>}
          />
        </Routes>
      </MemoryRouter>,
    );
  };

  it('quick-fill buttons fill the options properly', async () => {
    saveAdmin('grp-abc', { adminToken: 'token-abc', groupName: 'Test Group' });
    renderNewPollPage('grp-abc');

    // Click "Stages"
    const stagesBtn = screen.getByRole('button', { name: /Stages/i });
    await userEvent.click(stagesBtn);

    expect(screen.getByDisplayValue('Part 1')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Part 2')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Part 3 completed')).toBeInTheDocument();

    // Click "Yes / Not yet"
    const yesNoBtn = screen.getByRole('button', { name: /Yes \/ Not yet/i });
    await userEvent.click(yesNoBtn);

    expect(screen.getByDisplayValue('Yes')).toBeInTheDocument();
    expect(screen.getAllByDisplayValue('Not yet').length).toBeGreaterThanOrEqual(1);

    // Click "Add 'Need more time' option"
    const needMoreTimeBtn = screen.getByRole('button', {
      name: /Add "Need more time" option/i,
    });
    await userEvent.click(needMoreTimeBtn);

    expect(screen.getByDisplayValue('Need more time')).toBeInTheDocument();
  });

  it('an invalid form shows validation errors and does not call createPoll', async () => {
    saveAdmin('grp-abc', { adminToken: 'token-abc', groupName: 'Test Group' });
    renderNewPollPage('grp-abc');

    // Submit without typing a name
    const submitBtn = screen.getByRole('button', { name: /Create Poll/i });
    await userEvent.click(submitBtn);

    // Shows error
    expect(screen.getByText('Poll name is required.')).toBeInTheDocument();
    expect(endpoints.createPoll).not.toHaveBeenCalled();
  });

  it('a valid form submits the expected payload and navigates', async () => {
    saveAdmin('grp-abc', { adminToken: 'token-abc', groupName: 'Test Group' });
    vi.mocked(endpoints.createPoll).mockResolvedValue({
      id: 'poll-new-123',
      name: 'Project Demo',
      description_raw: 'Demo instructions',
      status: 'open',
      allow_multiple: false,
      deadline: null,
      completion_time_mode: 'last',
      created_at: '2026-10-01T12:00:00Z',
      options: [
        { id: 'opt-1', label: 'Yes', role: 'target', position: 0 },
        { id: 'opt-2', label: 'Not yet', role: 'not_yet', position: 1 },
      ],
    });

    renderNewPollPage('grp-abc');

    // Enter poll name
    const nameInput = screen.getByLabelText(/Poll Name/i);
    await userEvent.type(nameInput, 'Project Demo');

    // Enter description
    const descInput = screen.getByLabelText(/Description/i);
    await userEvent.type(descInput, 'Demo instructions');

    // Click Create Poll
    const submitBtn = screen.getByRole('button', { name: /Create Poll/i });
    await userEvent.click(submitBtn);

    await waitFor(() => {
      expect(endpoints.createPoll).toHaveBeenCalledWith('grp-abc', 'token-abc', {
        name: 'Project Demo',
        description_raw: 'Demo instructions',
        allow_multiple: false,
        deadline: null,
        completion_time_mode: 'last',
        options: [
          { label: 'Yes', role: 'target' },
          { label: 'Not yet', role: 'not_yet' },
        ],
      });
      expect(screen.getByTestId('poll-admin-page')).toBeInTheDocument();
    });
  });
});
