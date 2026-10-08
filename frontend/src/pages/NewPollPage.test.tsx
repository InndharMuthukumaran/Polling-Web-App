import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { NewPollPage } from './NewPollPage';
import * as endpoints from '../api/endpoints';
import { _clearAdminMemoryStore, saveAdmin } from '../lib/adminStorage';
import { ApiError } from '../api/client';
import type { AdminGroupDetailResponse, GroupField } from '../api/types';

vi.mock('../api/endpoints', () => ({
  createPoll: vi.fn(),
  getGroup: vi.fn(),
}));

describe('NewPollPage', () => {
  const sampleFields: GroupField[] = [
    {
      id: 'field-reg',
      key: 'reg_no',
      name: 'Register No',
      field_type: 'text',
      is_required: true,
      default_value: null,
      choices: null,
      is_identifier: true,
      position: 1,
    },
    {
      id: 'field-dept',
      key: 'department',
      name: 'Department',
      field_type: 'choice',
      is_required: false,
      default_value: 'CS',
      choices: ['CS', 'IT'],
      is_identifier: false,
      position: 2,
    },
  ];

  const sampleGroupDetail: AdminGroupDetailResponse = {
    id: 'grp-abc',
    name: 'Test Group',
    join_code: 'JOIN123',
    require_claim_approval: false,
    fields: sampleFields,
    members: [],
  };

  beforeEach(() => {
    localStorage.clear();
    _clearAdminMemoryStore();
    vi.clearAllMocks();
    vi.mocked(endpoints.getGroup).mockResolvedValue(sampleGroupDetail);
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
          <Route
            path="/g/:groupId/roster"
            element={<div data-testid="roster-page">Roster Page</div>}
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

  it('shows the identifier locked and checked; other fields optional', async () => {
    saveAdmin('grp-abc', { adminToken: 'token-abc', groupName: 'Test Group' });
    renderNewPollPage('grp-abc');

    await waitFor(() => {
      expect(screen.getByText('Register No')).toBeInTheDocument();
      expect(
        screen.getByText('Always included so you can tell people apart.'),
      ).toBeInTheDocument();
    });

    // Checkbox for identifier is disabled and checked
    const checkboxes = screen.getAllByRole('checkbox');
    const regCheckbox = checkboxes.find(
      (cb) =>
        cb.closest('label')?.textContent?.includes('Register No') &&
        cb.closest('label')?.textContent?.includes('Always included'),
    ) as HTMLInputElement;

    expect(regCheckbox).toBeInTheDocument();
    expect(regCheckbox.disabled).toBe(true);
    expect(regCheckbox.checked).toBe(true);

    // Department checkbox is enabled and unchecked by default
    const deptCheckbox = checkboxes.find((cb) =>
      cb.closest('label')?.textContent?.includes('Department'),
    ) as HTMLInputElement;

    expect(deptCheckbox).toBeInTheDocument();
    expect(deptCheckbox.disabled).toBe(false);
    expect(deptCheckbox.checked).toBe(false);

    // Checking department works
    await userEvent.click(deptCheckbox);
    expect(deptCheckbox.checked).toBe(true);
  });

  it('shows link to roster when group has no custom fields', async () => {
    saveAdmin('grp-abc', { adminToken: 'token-abc', groupName: 'Test Group' });
    vi.mocked(endpoints.getGroup).mockResolvedValue({
      ...sampleGroupDetail,
      fields: [],
    });

    renderNewPollPage('grp-abc');

    await waitFor(() => {
      expect(
        screen.getByText(/Your roster has no extra fields yet/i),
      ).toBeInTheDocument();
      expect(screen.getByRole('link', { name: /Go to roster page/i })).toBeInTheDocument();
    });
  });

  it('allows adding and removing poll-only fields', async () => {
    saveAdmin('grp-abc', { adminToken: 'token-abc', groupName: 'Test Group' });
    renderNewPollPage('grp-abc');

    await waitFor(() => {
      expect(screen.getByText('0 / 15')).toBeInTheDocument();
    });

    // Click "+ Add question"
    const addQuestionBtn = screen.getByRole('button', { name: /\+ Add question/i });
    await userEvent.click(addQuestionBtn);

    expect(screen.getByText('1 / 15')).toBeInTheDocument();
    expect(screen.getByText('Question 1')).toBeInTheDocument();
    expect(
      screen.getByPlaceholderText(/e\.g\. Expected CTC, T-Shirt Size, GitHub Profile/i),
    ).toBeInTheDocument();

    // Click "Remove"
    const removeBtn = screen.getByRole('button', { name: /Remove question/i });
    await userEvent.click(removeBtn);

    expect(screen.getByText('0 / 15')).toBeInTheDocument();
    expect(screen.queryByText('Question 1')).not.toBeInTheDocument();
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
      included_fields: [{ id: 'field-dept', key: 'department', name: 'Department', field_type: 'choice' }],
      poll_fields: [],
    });

    renderNewPollPage('grp-abc');

    await waitFor(() => {
      expect(screen.getByText('Register No')).toBeInTheDocument();
    });

    // Enter poll name
    const nameInput = screen.getByLabelText(/^Poll Name/i);
    await userEvent.type(nameInput, 'Project Demo');

    // Enter description
    const descInput = screen.getByLabelText(/Description/i);
    await userEvent.type(descInput, 'Demo instructions');

    // Check Department in included fields
    const deptCheckbox = screen
      .getAllByRole('checkbox')
      .find((cb) => cb.closest('label')?.textContent?.includes('Department'))!;
    await userEvent.click(deptCheckbox);

    // Add a poll-only question
    const addQuestionBtn = screen.getByRole('button', { name: /\+ Add question/i });
    await userEvent.click(addQuestionBtn);

    const qNameInput = screen.getByPlaceholderText(
      /e\.g\. Expected CTC, T-Shirt Size, GitHub Profile/i,
    );
    await userEvent.type(qNameInput, 'Expected CTC');

    // Select type "number"
    const typeSelect = screen.getByRole('combobox', { name: /Question type/i });
    await userEvent.selectOptions(typeSelect, 'number');

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
        included_field_ids: ['field-dept'],
        poll_fields: [
          {
            name: 'Expected CTC',
            field_type: 'number',
          },
        ],
      });
      expect(screen.getByTestId('poll-admin-page')).toBeInTheDocument();
    });
  });

  it('displays server details when server returns 422 with details', async () => {
    saveAdmin('grp-abc', { adminToken: 'token-abc', groupName: 'Test Group' });
    vi.mocked(endpoints.createPoll).mockRejectedValue(
      new ApiError(422, 'validation_error', 'Invalid poll configuration', [
        { field: 'poll_fields.0.name', message: 'Name already taken on server' },
      ]),
    );

    renderNewPollPage('grp-abc');

    await waitFor(() => {
      expect(screen.getByText('Register No')).toBeInTheDocument();
    });

    const nameInput = screen.getByLabelText(/Poll Name/i);
    await userEvent.type(nameInput, 'Project Demo');

    // Add question
    const addQuestionBtn = screen.getByRole('button', { name: /\+ Add question/i });
    await userEvent.click(addQuestionBtn);

    const qNameInput = screen.getByPlaceholderText(
      /e\.g\. Expected CTC, T-Shirt Size, GitHub Profile/i,
    );
    await userEvent.type(qNameInput, 'Some Question');

    const submitBtn = screen.getByRole('button', { name: /Create Poll/i });
    await userEvent.click(submitBtn);

    await waitFor(() => {
      expect(screen.getByText('Name already taken on server')).toBeInTheDocument();
      expect(screen.getByText('Invalid poll configuration')).toBeInTheDocument();
    });
  });
});
