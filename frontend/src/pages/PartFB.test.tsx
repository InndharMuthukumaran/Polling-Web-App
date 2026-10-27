import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { RosterPage } from './RosterPage';
import { AdminPollPage } from './AdminPollPage';
import { DashboardPage } from './DashboardPage';
import { JoinPage } from './JoinPage';
import { PollPage } from './PollPage';
import * as endpoints from '../api/endpoints';
import { ApiError } from '../api/client';
import { _clearAdminMemoryStore, getAdmin, saveAdmin } from '../lib/adminStorage';
import { _clearMemoryStore, getMemberIdentity, saveMemberIdentity } from '../lib/storage';
import type {
  AdminGroupDetailResponse,
  AdminPollHistoryResponse,
  AdminPollStatusResponse,
  GroupField,
  GroupMember,
} from '../api/types';

vi.mock('../api/endpoints', () => ({
  getGroup: vi.fn(),
  updateGroup: vi.fn(),
  deleteGroup: vi.fn(),
  createField: vi.fn(),
  updateField: vi.fn(),
  deleteField: vi.fn(),
  addMembers: vi.fn(),
  updateMember: vi.fn(),
  deleteMember: vi.fn(),
  deleteMembersBulk: vi.fn(),
  approveMemberClaim: vi.fn(),
  resetMemberClaim: vi.fn(),
  downloadMemberTemplate: vi.fn(),
  previewMemberImport: vi.fn(),
  importMembers: vi.fn(),
  downloadRoster: vi.fn(),
  getGroupPolls: vi.fn(),
  getAdminPollStatus: vi.fn(),
  getAdminPollHistory: vi.fn(),
  getPollResults: vi.fn(),
  closePoll: vi.fn(),
  reopenPoll: vi.fn(),
  deletePoll: vi.fn(),
  downloadPollResults: vi.fn(),
  getJoinInfo: vi.fn(),
  getPublicPoll: vi.fn(),
  getMe: vi.fn(),
  getMyPolls: vi.fn(),
  getMyPollHistory: vi.fn(),
  claimMember: vi.fn(),
  castVote: vi.fn(),
  deleteVote: vi.fn(),
}));

describe('Part FB - Deletions, Bulk Selection, Roster Export, 404 Handling', () => {
  const mockFields: GroupField[] = [
    {
      id: 'f-1',
      key: 'emp_id',
      name: 'Employee ID',
      field_type: 'text',
      is_required: true,
      default_value: null,
      choices: null,
      is_identifier: true,
      position: 1,
    },
  ];

  const mockMembers: GroupMember[] = [
    {
      id: 'm-1',
      display_name: 'Alice Smith',
      is_active: true,
      claim_status: 'approved',
      identifier: 'EMP001',
      values: { emp_id: 'EMP001' },
    },
    {
      id: 'm-2',
      display_name: 'Bob Jones',
      is_active: true,
      claim_status: 'unclaimed',
      identifier: 'EMP002',
      values: { emp_id: 'EMP002' },
    },
    {
      id: 'm-3',
      display_name: 'Charlie Brown',
      is_active: false,
      claim_status: 'unclaimed',
      identifier: 'EMP003',
      values: { emp_id: 'EMP003' },
    },
  ];

  const mockGroup: AdminGroupDetailResponse = {
    id: 'grp-100',
    name: 'Engineers Club',
    join_code: 'eng-join',
    require_claim_approval: false,
    allow_name_list: true,
    fields: mockFields,
    members: mockMembers,
  };

  beforeEach(() => {
    localStorage.clear();
    _clearAdminMemoryStore();
    _clearMemoryStore();
    vi.clearAllMocks();
  });

  describe('Roster Page: Deletions, Bulk Actions, Export & Modal Escape', () => {
    beforeEach(() => {
      saveAdmin('grp-100', { adminToken: 'adm-token', groupName: 'Engineers Club' });
      vi.mocked(endpoints.getGroup).mockResolvedValue(mockGroup);
    });

    it('single member delete confirms, calls deleteMember, and refreshes roster', async () => {
      vi.mocked(endpoints.deleteMember).mockResolvedValue();
      const user = userEvent.setup();

      render(
        <MemoryRouter initialEntries={['/g/grp-100/roster']}>
          <Routes>
            <Route path="/g/:groupId/roster" element={<RosterPage />} />
          </Routes>
        </MemoryRouter>,
      );

      await waitFor(() => {
        expect(screen.getAllByText('Alice Smith')[0]).toBeInTheDocument();
      });

      // Find the row for Alice Smith and click Delete
      const aliceRow = screen.getAllByText('Alice Smith')[0].closest('tr');
      expect(aliceRow).not.toBeNull();
      const deleteBtn = within(aliceRow!).getByRole('button', { name: /^Delete$/i });
      await user.click(deleteBtn);

      // Confirm dialog opens with required text
      expect(screen.getByRole('dialog')).toBeInTheDocument();
      expect(
        screen.getByText(/Delete Alice Smith\? This permanently deletes them and their votes/i),
      ).toBeInTheDocument();

      // Click Confirm Delete inside dialog
      const confirmDeleteBtn = within(screen.getByRole('dialog')).getByRole('button', {
        name: 'Delete',
      });
      await user.click(confirmDeleteBtn);

      await waitFor(() => {
        expect(endpoints.deleteMember).toHaveBeenCalledWith('grp-100', 'm-1', 'adm-token');
        // getGroup should be called again to refresh
        expect(endpoints.getGroup).toHaveBeenCalledTimes(2);
      });
    });

    it('bulk selection shows selection bar, supports select all matching, and executes bulk delete', async () => {
      vi.mocked(endpoints.deleteMembersBulk).mockResolvedValue({ deleted: 2 });
      const user = userEvent.setup();

      render(
        <MemoryRouter initialEntries={['/g/grp-100/roster']}>
          <Routes>
            <Route path="/g/:groupId/roster" element={<RosterPage />} />
          </Routes>
        </MemoryRouter>,
      );

      await waitFor(() => {
        expect(screen.getAllByText('Alice Smith')[0]).toBeInTheDocument();
      });

      // Select Alice Smith and Bob Jones checkboxes
      const checkboxes = screen.getAllByRole('checkbox');
      // checkboxes[0] is header select-all, 1 is row 1, 2 is row 2, etc.
      await user.click(checkboxes[1]);
      await user.click(checkboxes[2]);

      // Selection bar appears
      expect(screen.getByText('2 selected')).toBeInTheDocument();

      // Click "Delete selected"
      const deleteSelectedBtn = screen.getByRole('button', { name: 'Delete selected' });
      await user.click(deleteSelectedBtn);

      // Confirm dialog shows required plural text
      expect(screen.getByRole('dialog')).toBeInTheDocument();
      expect(
        screen.getByText(/Delete 2 members\? This permanently deletes them and their votes/i),
      ).toBeInTheDocument();

      // Confirm
      const confirmBtn = within(screen.getByRole('dialog')).getByRole('button', {
        name: 'Delete',
      });
      await user.click(confirmBtn);

      await waitFor(() => {
        expect(endpoints.deleteMembersBulk).toHaveBeenCalledWith(
          'grp-100',
          expect.arrayContaining(['m-1', 'm-2']),
          'adm-token',
        );
        expect(endpoints.getGroup).toHaveBeenCalledTimes(2);
      });
    });

    it('download roster menu downloads Excel and CSV with admin token', async () => {
      const mockBlob = Object.assign(new Blob(['csv content'], { type: 'text/csv' }), {
        filename: 'roster-engineers-club.csv',
        blob: new Blob(['csv content']),
      });
      vi.mocked(endpoints.downloadRoster).mockResolvedValue(mockBlob);

      const user = userEvent.setup();

      render(
        <MemoryRouter initialEntries={['/g/grp-100/roster']}>
          <Routes>
            <Route path="/g/:groupId/roster" element={<RosterPage />} />
          </Routes>
        </MemoryRouter>,
      );

      await waitFor(() => {
        expect(screen.getAllByText('Alice Smith')[0]).toBeInTheDocument();
      });

      // Open Download roster menu
      const downloadMenuBtn = screen.getByRole('button', { name: /Download roster/i });
      await user.click(downloadMenuBtn);

      // Click CSV
      const csvBtn = screen.getByRole('button', { name: 'CSV' });
      await user.click(csvBtn);

      expect(endpoints.downloadRoster).toHaveBeenCalledWith('grp-100', 'adm-token', 'csv');

      // Click Excel
      await user.click(downloadMenuBtn);
      const excelBtn = screen.getByRole('button', { name: 'Excel' });
      await user.click(excelBtn);

      expect(endpoints.downloadRoster).toHaveBeenCalledWith('grp-100', 'adm-token', 'xlsx');
    });

    it('add and edit member modals close when Escape key is pressed', async () => {
      const user = userEvent.setup();

      render(
        <MemoryRouter initialEntries={['/g/grp-100/roster']}>
          <Routes>
            <Route path="/g/:groupId/roster" element={<RosterPage />} />
          </Routes>
        </MemoryRouter>,
      );

      await waitFor(() => {
        expect(screen.getAllByText('Alice Smith')[0]).toBeInTheDocument();
      });

      // Open Add Member modal
      const addMemberBtn = screen.getByRole('button', { name: /Add member/i });
      await user.click(addMemberBtn);

      expect(screen.getByRole('heading', { name: 'Add New Member' })).toBeInTheDocument();

      // Press Escape
      fireEvent.keyDown(window, { key: 'Escape' });

      await waitFor(() => {
        expect(screen.queryByRole('heading', { name: 'Add New Member' })).not.toBeInTheDocument();
      });

      // Open Edit Member modal for Alice
      const aliceRow = screen.getAllByText('Alice Smith')[0].closest('tr');
      const editBtn = within(aliceRow!).getByRole('button', { name: /^Edit$/i });
      await user.click(editBtn);

      expect(screen.getByRole('heading', { name: 'Edit Member' })).toBeInTheDocument();

      // Press Escape
      fireEvent.keyDown(window, { key: 'Escape' });

      await waitFor(() => {
        expect(screen.queryByRole('heading', { name: 'Edit Member' })).not.toBeInTheDocument();
      });
    });
  });

  describe('Admin Poll Page: Delete Poll & Results Download inside Modal', () => {
    const mockPollStatus: AdminPollStatusResponse = {
      poll: {
        id: 'poll-55',
        name: 'Weekly Planning',
        status: 'open',
        allow_multiple: false,
        deadline: '2026-12-01T12:00:00Z',
        completion_time_mode: 'last',
      },
      counts: { total_active: 3, at_target: 1, excused: 0, behind_target: 1, not_voted: 1 },
      all_reached: false,
      at_target: [
        {
          member_id: 'm-1',
          display_name: 'Alice Smith',
          late: false,
          completed_at: '2026-11-20T10:00:00Z',
        },
      ],
      excused: [],
      behind_target: [{ member_id: 'm-2', display_name: 'Bob Jones' }],
      not_voted: [{ member_id: 'm-3', display_name: 'Charlie Brown' }],
    };

    const mockPollHistory: AdminPollHistoryResponse = [];

    beforeEach(() => {
      saveAdmin('grp-100', { adminToken: 'adm-token', groupName: 'Engineers Club' });
      vi.mocked(endpoints.getAdminPollStatus).mockResolvedValue(mockPollStatus);
      vi.mocked(endpoints.getAdminPollHistory).mockResolvedValue(mockPollHistory);
    });

    it('delete poll button opens confirm dialog with download buttons and deletes poll', async () => {
      vi.mocked(endpoints.deletePoll).mockResolvedValue();
      const mockResultsBlob = Object.assign(new Blob(['results'], { type: 'text/csv' }), {
        filename: 'results.csv',
        blob: new Blob(['results']),
      });
      vi.mocked(endpoints.downloadPollResults).mockResolvedValue(mockResultsBlob);

      const user = userEvent.setup();

      render(
        <MemoryRouter initialEntries={['/g/grp-100/polls/poll-55']}>
          <Routes>
            <Route path="/g/:groupId/polls/:pollId" element={<AdminPollPage />} />
            <Route path="/g/:groupId" element={<div>Dashboard Page Reached</div>} />
          </Routes>
        </MemoryRouter>,
      );

      await waitFor(() => {
        expect(screen.getByText('Weekly Planning')).toBeInTheDocument();
      });

      // Click "Delete poll" in Manage section
      const deletePollBtn = screen.getByRole('button', { name: 'Delete poll' });
      await user.click(deletePollBtn);

      // Confirm dialog opens
      expect(screen.getByRole('dialog')).toBeInTheDocument();
      expect(
        screen.getByText(/Delete this poll\? This permanently deletes the poll with all votes/i),
      ).toBeInTheDocument();

      // Download results buttons inside dialog
      const dlCsvBtn = screen.getByRole('button', { name: 'Download results (CSV)' });
      await user.click(dlCsvBtn);
      expect(endpoints.downloadPollResults).toHaveBeenCalledWith('poll-55', 'adm-token', 'csv');

      // Click Confirm Delete inside dialog
      const confirmDeleteBtn = within(screen.getByRole('dialog')).getByRole('button', {
        name: 'Delete poll',
      });
      await user.click(confirmDeleteBtn);

      await waitFor(() => {
        expect(endpoints.deletePoll).toHaveBeenCalledWith('poll-55', 'adm-token');
        expect(screen.getByText('Dashboard Page Reached')).toBeInTheDocument();
      });
    });
  });

  describe('Dashboard Page: Danger Zone & Group Deletion', () => {
    beforeEach(() => {
      saveAdmin('grp-100', { adminToken: 'adm-token', groupName: 'Engineers Club' });
      vi.mocked(endpoints.getGroup).mockResolvedValue(mockGroup);
      vi.mocked(endpoints.getGroupPolls).mockResolvedValue([]);
    });

    it('danger zone shows counts, delete stays disabled until exact name typed, clears storage, and redirects home', async () => {
      vi.mocked(endpoints.deleteGroup).mockResolvedValue();
      const user = userEvent.setup();

      render(
        <MemoryRouter initialEntries={['/g/grp-100']}>
          <Routes>
            <Route path="/g/:groupId" element={<DashboardPage />} />
            <Route path="/" element={<div>Home Page Screen</div>} />
          </Routes>
        </MemoryRouter>,
      );

      await waitFor(() => {
        expect(screen.getByText('Engineers Club')).toBeInTheDocument();
      });

      // Danger zone card
      expect(screen.getByText('Danger zone')).toBeInTheDocument();
      expect(screen.getByText(/3 in roster/i)).toBeInTheDocument();

      // Click "Delete this group"
      const deleteGroupBtn = screen.getByRole('button', { name: 'Delete this group' });
      await user.click(deleteGroupBtn);

      // Dialog opens
      expect(screen.getByRole('dialog')).toBeInTheDocument();
      expect(
        screen.getByText(/This permanently deletes the group, its members, fields, polls/i),
      ).toBeInTheDocument();

      // Delete confirm button is initially disabled
      const confirmDeleteBtn = within(screen.getByRole('dialog')).getByRole('button', {
        name: 'Delete this group',
      });
      expect(confirmDeleteBtn).toBeDisabled();

      // Type partial or wrong name
      const nameInput = screen.getByPlaceholderText('Type the group name to confirm');
      fireEvent.change(nameInput, { target: { value: 'Wrong Name' } });
      expect(confirmDeleteBtn).toBeDisabled();

      // Type exact name
      fireEvent.change(nameInput, { target: { value: 'Engineers Club' } });
      expect(confirmDeleteBtn).not.toBeDisabled();

      // Click delete
      await user.click(confirmDeleteBtn);

      await waitFor(() => {
        expect(endpoints.deleteGroup).toHaveBeenCalledWith(
          'grp-100',
          'adm-token',
          'Engineers Club',
        );
        // Admin token removed from storage
        expect(getAdmin('grp-100')).toBeNull();
        expect(screen.getByText('Home Page Screen')).toBeInTheDocument();
      });
    });
  });

  describe('404 Handling: JoinPage and PollPage', () => {
    it('JoinPage shows "This group or poll no longer exists." on 404 and clears saved identity', async () => {
      saveMemberIdentity('eng-join', {
        memberToken: 'mem-tok',
        memberId: 'm-1',
        displayName: 'Alice Smith',
      });
      expect(getMemberIdentity('eng-join')).not.toBeNull();

      vi.mocked(endpoints.getJoinInfo).mockRejectedValue(
        new ApiError(404, 'not_found', 'Group not found'),
      );

      render(
        <MemoryRouter initialEntries={['/join/eng-join']}>
          <Routes>
            <Route path="/join/:joinCode" element={<JoinPage />} />
          </Routes>
        </MemoryRouter>,
      );

      await waitFor(() => {
        expect(screen.getByText('This group or poll no longer exists.')).toBeInTheDocument();
        expect(getMemberIdentity('eng-join')).toBeNull();
      });
    });

    it('PollPage shows "This group or poll no longer exists." on 404 and clears saved identity', async () => {
      saveMemberIdentity('eng-join', {
        memberToken: 'mem-tok',
        memberId: 'm-1',
        displayName: 'Alice Smith',
      });
      expect(getMemberIdentity('eng-join')).not.toBeNull();

      vi.mocked(endpoints.getPublicPoll).mockRejectedValue(
        new ApiError(404, 'not_found', 'Poll not found'),
      );

      render(
        <MemoryRouter initialEntries={['/p/poll-999']}>
          <Routes>
            <Route path="/p/:pollId" element={<PollPage />} />
          </Routes>
        </MemoryRouter>,
      );

      await waitFor(() => {
        expect(screen.getByText('This group or poll no longer exists.')).toBeInTheDocument();
        expect(getMemberIdentity('eng-join')).toBeNull();
      });
    });
  });
});
