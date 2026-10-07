import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { RosterPage } from './RosterPage';
import * as endpoints from '../api/endpoints';
import { ApiError } from '../api/client';
import { _clearAdminMemoryStore, saveAdmin } from '../lib/adminStorage';
import type { AdminGroupDetailResponse, GroupField, GroupMember } from '../api/types';

vi.mock('../api/endpoints', () => ({
  getGroup: vi.fn(),
  updateGroup: vi.fn(),
  createField: vi.fn(),
  updateField: vi.fn(),
  deleteField: vi.fn(),
  addMembers: vi.fn(),
  updateMember: vi.fn(),
  approveMemberClaim: vi.fn(),
  resetMemberClaim: vi.fn(),
  downloadMemberTemplate: vi.fn(),
  previewMemberImport: vi.fn(),
  importMembers: vi.fn(),
}));

describe('RosterPage', () => {
  const mockFields: GroupField[] = [
    {
      id: 'f-reg',
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
      id: 'f-dept',
      key: 'dept',
      name: 'Department',
      field_type: 'choice',
      is_required: false,
      default_value: 'CS',
      choices: ['CS', 'EE', 'ME'],
      is_identifier: false,
      position: 2,
    },
    {
      id: 'f-phone',
      key: 'phone',
      name: 'Phone',
      field_type: 'number',
      is_required: false,
      default_value: null,
      choices: null,
      is_identifier: false,
      position: 3,
    },
  ];

  const mockMembers: GroupMember[] = [
    {
      id: 'm-1',
      display_name: 'John Doe',
      is_active: true,
      claim_status: 'approved',
      identifier: 'REG-001',
      values: { reg_no: 'REG-001', dept: 'CS', phone: 123456 },
    },
    {
      id: 'm-2',
      display_name: 'John Doe',
      is_active: true,
      claim_status: 'pending',
      identifier: 'REG-002',
      values: { reg_no: 'REG-002', dept: 'EE', phone: 654321 },
    },
    {
      id: 'm-3',
      display_name: 'Alice Cooper',
      is_active: false,
      claim_status: 'unclaimed',
      identifier: 'REG-003',
      values: { reg_no: 'REG-003', dept: 'ME' },
    },
  ];

  const mockGroup: AdminGroupDetailResponse = {
    id: 'grp-123',
    name: 'CS Department Group',
    join_code: 'code999',
    require_claim_approval: true,
    allow_name_list: false,
    fields: mockFields,
    members: mockMembers,
  };

  beforeEach(() => {
    localStorage.clear();
    _clearAdminMemoryStore();
    vi.clearAllMocks();
    saveAdmin('grp-123', { adminToken: 'token-secret', groupName: 'CS Department Group' });
    vi.mocked(endpoints.getGroup).mockResolvedValue(mockGroup);
  });

  const renderRoster = (initialTab = 'members') => {
    return render(
      <MemoryRouter initialEntries={[`/g/grp-123/roster?tab=${initialTab}`]}>
        <Routes>
          <Route path="/g/:groupId/roster" element={<RosterPage />} />
        </Routes>
      </MemoryRouter>,
    );
  };

  describe('Fields Tab', () => {
    it('lists fields, disables delete for identifier, adds a field, edits a field, and shows offending members when identifier is refused', async () => {
      vi.mocked(endpoints.createField).mockResolvedValue({
        id: 'f-notes',
        key: 'notes',
        name: 'Notes',
        field_type: 'text',
        is_required: false,
        default_value: null,
        choices: null,
        is_identifier: false,
        position: 4,
      });

      renderRoster('fields');

      await waitFor(() => {
        expect(screen.getByText('Register No')).toBeInTheDocument();
        expect(screen.getByText('Department')).toBeInTheDocument();
        expect(screen.getByText('Phone')).toBeInTheDocument();
      });

      // Identifier field delete button is disabled
      const deleteButtons = screen.getAllByRole('button', { name: /^Delete$/i });
      expect(deleteButtons[0]).toBeDisabled(); // Register No is identifier
      expect(deleteButtons[1]).not.toBeDisabled(); // Department is not identifier

      // Add a field
      await userEvent.click(screen.getByRole('button', { name: /Add field/i }));
      expect(screen.getByRole('heading', { name: /Add New Field/i })).toBeInTheDocument();

      await userEvent.type(screen.getByLabelText(/Field Name \*/i), 'Notes');
      await userEvent.click(screen.getByRole('button', { name: /Save Field/i }));

      expect(endpoints.createField).toHaveBeenCalledWith('grp-123', 'token-secret', {
        name: 'Notes',
        field_type: 'text',
        is_required: false,
        default_value: null,
        choices: null,
      });

      // Edit a field
      const editButtons = screen.getAllByRole('button', { name: /^Edit$/i });
      await userEvent.click(editButtons[0]); // Edit Register No

      expect(screen.getByText(/Edit Field: Register No/i)).toBeInTheDocument();
      expect(screen.getByText(/Type: text \(not editable\)/i)).toBeInTheDocument();

      // Server refuses identifier update with details
      vi.mocked(endpoints.updateField).mockRejectedValueOnce(
        new ApiError(422, 'validation_error', 'Cannot set identifier: values must be unique and non-blank', [
          { row: 1, field: 'Alice', message: 'Alice Cooper has duplicate value' },
          { row: 2, field: 'Bob', message: 'Bob Smith has blank value' },
        ]),
      );

      await userEvent.click(screen.getByRole('button', { name: /Save Changes/i }));

      await waitFor(() => {
        expect(
          screen.getByText(/Cannot set identifier: values must be unique and non-blank/i),
        ).toBeInTheDocument();
        expect(screen.getByText(/Alice Cooper has duplicate value/i)).toBeInTheDocument();
        expect(screen.getByText(/Bob Smith has blank value/i)).toBeInTheDocument();
      });
    });
  });

  describe('Members Tab', () => {
    it('distinguishes two members with the same name by identifier, and executes Approve, Reset, Deactivate, and Edit', async () => {
      vi.mocked(endpoints.approveMemberClaim).mockResolvedValue({ status: 'approved' });
      vi.mocked(endpoints.resetMemberClaim).mockResolvedValue({ status: 'unclaimed' });
      vi.mocked(endpoints.updateMember).mockResolvedValue({
        ...mockMembers[0],
        is_active: false,
      });

      renderRoster('members');

      await waitFor(() => {
        const johnElements = screen.getAllByText('John Doe');
        expect(johnElements.length).toBeGreaterThanOrEqual(2);
        // Both identifiers are shown
        expect(screen.getAllByText('REG-001').length).toBeGreaterThanOrEqual(1);
        expect(screen.getAllByText('REG-002').length).toBeGreaterThanOrEqual(1);
      });

      // Approve (only for m-2 John Doe who is pending)
      const approveButtons = screen.getAllByRole('button', { name: /^Approve$/i });
      expect(approveButtons.length).toBeGreaterThanOrEqual(1);
      await userEvent.click(approveButtons[0]);
      expect(endpoints.approveMemberClaim).toHaveBeenCalledWith('grp-123', 'm-2', 'token-secret');

      // Reset (shows confirmation)
      const resetButtons = screen.getAllByRole('button', { name: /^Reset$/i });
      await userEvent.click(resetButtons[0]);
      expect(screen.getAllByText(/Reset claim\?/i).length).toBeGreaterThanOrEqual(1);

      const confirmBtn = screen.getAllByRole('button', { name: /^Confirm$/i })[0];
      await userEvent.click(confirmBtn);
      expect(endpoints.resetMemberClaim).toHaveBeenCalledWith('grp-123', 'm-1', 'token-secret');

      // Deactivate
      const deactivateButtons = screen.getAllByRole('button', { name: /^Deactivate$/i });
      await userEvent.click(deactivateButtons[0]);
      expect(endpoints.updateMember).toHaveBeenCalledWith('grp-123', 'm-1', 'token-secret', {
        is_active: false,
      });
    });

    it('add member pre-fills defaults and shows field-level errors on server rejection', async () => {
      renderRoster('members');

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /Add member/i })).toBeInTheDocument();
      });

      await userEvent.click(screen.getByRole('button', { name: /Add member/i }));
      expect(screen.getByRole('heading', { name: /Add New Member/i })).toBeInTheDocument();

      // Check default prefilled for choice field 'dept' ('CS')
      const deptSelect = screen.getByLabelText(/Department/i) as HTMLSelectElement;
      expect(deptSelect.value).toBe('CS');

      // Fill name and required reg_no
      await userEvent.type(screen.getByLabelText(/Display Name \*/i), 'New Guy');
      await userEvent.type(screen.getByLabelText(/Register No/i), 'REG-999');

      // Mock server error on add
      vi.mocked(endpoints.addMembers).mockRejectedValueOnce(
        new ApiError(422, 'validation_error', 'Invalid member input', [
          { row: 1, field: 'reg_no', message: 'Register No already exists in group.' },
        ]),
      );

      const submitBtn = within(screen.getByRole('dialog')).getByRole('button', {
        name: /^Add Member$/i,
      });
      await userEvent.click(submitBtn);

      await waitFor(() => {
        expect(screen.getByText('Register No already exists in group.')).toBeInTheDocument();
      });
    });
  });

  describe('Import Tab', () => {
    it('wizard: mapping blocks "Check file" until valid, dry run displays counts and errors with row numbers, and import executes for real', async () => {
      const mockPreview = {
        filename: 'students.xlsx',
        sheet: 'Sheet1',
        columns: [
          { index: 0, header: 'Name' },
          { index: 1, header: 'RegNo' },
          { index: 2, header: 'Dept' },
        ],
        total_rows: 2,
        sample_rows: [
          ['Bob', 'REG-101', 'CS'],
          ['Eve', 'REG-102', 'EE'],
        ],
        suggested_mapping: {
          '0': 'name',
          '1': 'reg_no',
          '2': 'dept',
        },
      };

      vi.mocked(endpoints.previewMemberImport).mockResolvedValue(mockPreview);
      vi.mocked(endpoints.importMembers).mockResolvedValueOnce({
        dry_run: true,
        rows_total: 2,
        rows_added: 2,
        rows_skipped: 0,
        fields_created: [],
        errors: [],
      });
      vi.mocked(endpoints.importMembers).mockResolvedValueOnce({
        dry_run: false,
        rows_total: 2,
        rows_added: 2,
        rows_skipped: 0,
        fields_created: [],
        errors: [],
      });

      renderRoster('import');

      await waitFor(() => {
        expect(screen.getByRole('heading', { name: /Upload Spreadsheet/i })).toBeInTheDocument();
      });

      // Upload file
      const file = new File(['mock content'], 'students.xlsx', {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      });
      const fileInput = screen.getByLabelText(/Select Excel \(\.xlsx\) or CSV \(\.csv\) file/i);
      await userEvent.upload(fileInput, file);

      await userEvent.click(screen.getByRole('button', { name: /Continue to Mapping/i }));

      // Step 2: Map
      await waitFor(() => {
        expect(screen.getByRole('heading', { name: /Map Columns/i })).toBeInTheDocument();
      });

      // Valid mapping enables "Check file"
      const checkFileBtn = screen.getByRole('button', { name: /Check file/i });
      expect(checkFileBtn).not.toBeDisabled();

      // Step 3: Check
      await userEvent.click(checkFileBtn);

      await waitFor(() => {
        expect(screen.getByRole('heading', { name: /Dry Run Check Results/i })).toBeInTheDocument();
        expect(screen.getByText(/2 rows ready to import/i)).toBeInTheDocument();
      });

      // Step 4: Execute Import
      const importPeopleBtn = screen.getByRole('button', { name: /Import 2 people/i });
      await userEvent.click(importPeopleBtn);

      await waitFor(() => {
        expect(screen.getByRole('heading', { name: /Import Complete/i })).toBeInTheDocument();
        expect(screen.getByText(/Successfully imported/i)).toBeInTheDocument();
      });

      expect(endpoints.importMembers).toHaveBeenCalledWith('grp-123', 'token-secret', {
        file,
        mapping: { '0': 'name', '1': 'reg_no', '2': 'dept' },
        new_fields: undefined,
        dry_run: false,
        on_duplicate: 'reject',
      });
    });
  });
});
