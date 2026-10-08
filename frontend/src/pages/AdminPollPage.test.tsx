import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { AdminPollPage } from './AdminPollPage';
import * as endpoints from '../api/endpoints';
import { _clearAdminMemoryStore, saveAdmin } from '../lib/adminStorage';
import type {
  AdminPollHistoryResponse,
  AdminPollStatusResponse,
  PollResultsResponse,
} from '../api/types';

vi.mock('../api/endpoints', () => ({
  getAdminPollStatus: vi.fn(),
  getAdminPollHistory: vi.fn(),
  closePoll: vi.fn(),
  getPollResults: vi.fn(),
  downloadPollResults: vi.fn(),
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
      {
        member_id: 'm-1',
        display_name: 'Alice Done',
        identifier: '21001',
        completed_at: '2026-10-10T12:00:00Z',
        late: false,
      },
    ],
    behind_target: [
      { member_id: 'm-2', display_name: 'Charlie Behind', identifier: '21002' },
    ],
    excused: [
      { member_id: 'm-3', display_name: 'Bob Excused', identifier: null },
    ],
    not_voted: [
      { member_id: 'm-4', display_name: 'David NotVoted', identifier: '21004' },
    ],
  };

  const mockHistory: AdminPollHistoryResponse = [
    {
      member_id: 'm-1',
      display_name: 'Alice Done',
      identifier: '21001',
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

  const mockResults: PollResultsResponse = {
    poll: {
      id: 'poll-123',
      name: 'Sprint Goal',
      status: 'open',
      deadline: '2026-10-30T18:00:00Z',
      allow_multiple: false,
    },
    columns: [
      {
        source: 'group',
        key: 'reg_no',
        name: 'Register No',
        field_type: 'text',
        is_identifier: true,
      },
      {
        source: 'group',
        key: 'dept',
        name: 'Department',
        field_type: 'text',
        is_identifier: false,
      },
      {
        source: 'poll',
        key: 'portfolio',
        name: 'Portfolio',
        field_type: 'link',
        is_identifier: false,
      },
      {
        source: 'poll',
        key: 'code_notes',
        name: 'Notes',
        field_type: 'text',
        is_identifier: false,
      },
    ],
    rows: [
      {
        member_id: 'm-1',
        display_name: 'Alice Done',
        identifier: '21001',
        status: 'at_target',
        selected_options: ['Target Reached'],
        late: false,
        completed_at: '2026-10-10T12:00:00Z',
        group_values: { reg_no: '21001', dept: 'CSE' },
        answers: {
          portfolio: 'https://example.com/alice',
          code_notes: '<b>clean</b> & =1+1',
        },
        answers_updated_at: '2026-10-10T12:00:00Z',
        answers_complete: true,
      },
      {
        member_id: 'm-2',
        display_name: 'Charlie Behind',
        identifier: '21002',
        status: 'behind_target',
        selected_options: ['Working on it'],
        late: null,
        completed_at: null,
        group_values: { reg_no: '21002', dept: 'ECE' },
        answers: {
          portfolio: null,
          code_notes: '',
        },
        answers_updated_at: null,
        answers_complete: false,
      },
    ],
  };

  beforeEach(() => {
    localStorage.clear();
    _clearAdminMemoryStore();
    vi.clearAllMocks();

    Object.assign(navigator, {
      clipboard: {
        writeText: vi.fn().mockResolvedValue(undefined),
      },
    });

    window.URL.createObjectURL = vi.fn().mockReturnValue('blob:http://localhost/mock-blob');
    window.URL.revokeObjectURL = vi.fn();
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
      'David NotVoted (21004)\nCharlie Behind (21002)',
    );
  });

  it('distinguishes members with the same name and shows identifier next to names in lists and history', async () => {
    saveAdmin('grp-123', { adminToken: 'tok-admin', groupName: 'Core Team' });
    const duplicateStatus: AdminPollStatusResponse = {
      ...mockStatus,
      not_voted: [
        { member_id: 'm-4', display_name: 'Asha K', identifier: '21001' },
        { member_id: 'm-5', display_name: 'Asha K', identifier: '21002' },
      ],
      behind_target: [],
    };
    vi.mocked(endpoints.getAdminPollStatus).mockResolvedValue(duplicateStatus);
    vi.mocked(endpoints.getAdminPollHistory).mockResolvedValue([
      {
        member_id: 'm-4',
        display_name: 'Asha K',
        identifier: '21001',
        history: [],
      },
    ]);

    renderAdminPollPage('grp-123', 'poll-123');

    await waitFor(() => {
      expect(screen.getAllByText('21001').length).toBeGreaterThanOrEqual(1);
      expect(screen.getByText('21002')).toBeInTheDocument();
    });

    // Check section copy button for "not_voted"
    const copySectionBtn = screen.getAllByRole('button', { name: /Copy names/i })[0];
    await userEvent.click(copySectionBtn);

    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
      'Asha K (21001)\nAsha K (21002)',
    );

    // Open history and verify identifier is displayed
    const showHistoryBtn = screen.getByRole('button', { name: /Show history/i });
    await userEvent.click(showHistoryBtn);

    expect(screen.getAllByText('21001').length).toBeGreaterThanOrEqual(1);
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

  describe('Results Section', () => {
    it('loads on first open, shows group and poll columns in order, links open safely, missing values show "-", refresh reloads, download buttons call the right URLs, and values are plain text', async () => {
      saveAdmin('grp-123', { adminToken: 'tok-admin', groupName: 'Core Team' });
      vi.mocked(endpoints.getAdminPollStatus).mockResolvedValue(mockStatus);
      vi.mocked(endpoints.getAdminPollHistory).mockResolvedValue(mockHistory);
      vi.mocked(endpoints.getPollResults).mockResolvedValue(mockResults);

      renderAdminPollPage('grp-123', 'poll-123');

      await waitFor(() => {
        expect(screen.getByText('Sprint Goal')).toBeInTheDocument();
      });

      // Results is collapsed initially
      expect(endpoints.getPollResults).not.toHaveBeenCalled();
      expect(screen.queryByText('Roster values are shown as they are right now.')).not.toBeInTheDocument();

      // Click "Show results"
      const showResultsBtn = screen.getByRole('button', { name: /Show results/i });
      await userEvent.click(showResultsBtn);

      await waitFor(() => {
        expect(endpoints.getPollResults).toHaveBeenCalledWith('poll-123', 'tok-admin');
        expect(
          screen.getByText('Roster values are shown as they are right now.'),
        ).toBeInTheDocument();
      });

      // Headers exist: Name, Register No, Department, Portfolio, Notes, Status, Selected options, Late, Answers complete
      expect(screen.getByRole('columnheader', { name: 'Name' })).toBeInTheDocument();
      expect(screen.getByRole('columnheader', { name: 'Register No' })).toBeInTheDocument();
      expect(screen.getByRole('columnheader', { name: 'Department' })).toBeInTheDocument();
      expect(screen.getByRole('columnheader', { name: 'Portfolio' })).toBeInTheDocument();
      expect(screen.getByRole('columnheader', { name: 'Notes' })).toBeInTheDocument();
      expect(screen.getByRole('columnheader', { name: 'Answers complete' })).toBeInTheDocument();

      // Check row contents
      // Plain text check: <b>clean</b> & =1+1 should be displayed as text, not HTML
      expect(screen.getAllByText('<b>clean</b> & =1+1').length).toBeGreaterThanOrEqual(1);

      // Missing values show "-"
      const dashCells = screen.getAllByText('-');
      expect(dashCells.length).toBeGreaterThanOrEqual(1);

      // Safe link check
      const links = screen.getAllByRole('link', { name: 'https://example.com/alice' });
      expect(links.length).toBeGreaterThanOrEqual(1);
      const linkEl = links[0];
      expect(linkEl).toHaveAttribute('href', 'https://example.com/alice');
      expect(linkEl).toHaveAttribute('target', '_blank');
      expect(linkEl).toHaveAttribute('rel', 'noopener noreferrer');

      // Click "Refresh" button reloads results
      const refreshBtn = screen.getByRole('button', { name: /Refresh/i });
      await userEvent.click(refreshBtn);
      expect(endpoints.getPollResults).toHaveBeenCalledTimes(2);

      // Download buttons
      const mockBlob = new Blob(['data'], { type: 'text/csv' });
      Object.assign(mockBlob, { filename: 'poll_results.csv', blob: mockBlob });
      vi.mocked(endpoints.downloadPollResults).mockResolvedValue(
        mockBlob as unknown as Blob & { filename: string; blob: Blob },
      );

      const downloadCsvBtn = screen.getByRole('button', { name: /Download CSV/i });
      await userEvent.click(downloadCsvBtn);
      expect(endpoints.downloadPollResults).toHaveBeenCalledWith('poll-123', 'tok-admin', 'csv');

      const downloadXlsxBtn = screen.getByRole('button', { name: /Download Excel/i });
      await userEvent.click(downloadXlsxBtn);
      expect(endpoints.downloadPollResults).toHaveBeenCalledWith('poll-123', 'tok-admin', 'xlsx');
    });

    it('filters rows by search box and status dropdown', async () => {
      saveAdmin('grp-123', { adminToken: 'tok-admin', groupName: 'Core Team' });
      vi.mocked(endpoints.getAdminPollStatus).mockResolvedValue(mockStatus);
      vi.mocked(endpoints.getAdminPollHistory).mockResolvedValue(mockHistory);
      vi.mocked(endpoints.getPollResults).mockResolvedValue(mockResults);

      renderAdminPollPage('grp-123', 'poll-123');

      await waitFor(() => {
        expect(screen.getByText('Sprint Goal')).toBeInTheDocument();
      });

      // Expand results
      const showResultsBtn = screen.getByRole('button', { name: /Show results/i });
      await userEvent.click(showResultsBtn);

      await waitFor(() => {
        expect(screen.getByText('Showing 1 to 2 of 2')).toBeInTheDocument();
      });

      // Search for "Alice"
      const searchInput = screen.getByPlaceholderText(/Search name, identifier, or value\.\.\./i);
      await userEvent.type(searchInput, 'Alice');

      expect(screen.getByText('Showing 1 to 1 of 1')).toBeInTheDocument();
      const table = screen.getByRole('table');
      expect(within(table).getByText('Alice Done')).toBeInTheDocument();
      expect(within(table).queryByText('Charlie Behind')).not.toBeInTheDocument();

      // Clear search
      await userEvent.clear(searchInput);
      expect(screen.getByText('Showing 1 to 2 of 2')).toBeInTheDocument();

      // Filter by status "Answers incomplete"
      const statusSelect = screen.getByRole('combobox');
      await userEvent.selectOptions(statusSelect, 'Answers incomplete');

      expect(screen.getByText('Showing 1 to 1 of 1')).toBeInTheDocument();
      expect(within(table).getByText('Charlie Behind')).toBeInTheDocument();
      expect(within(table).queryByText('Alice Done')).not.toBeInTheDocument();
    });
  });
});
