import { describe, expect, it } from 'vitest';
import type { PollResultColumn, PollResultRow } from '../api/types';
import {
  columnValue,
  filterResultRows,
  formatCopyLine,
  statusLabel,
} from './results';

describe('results.ts pure helpers', () => {
  describe('formatCopyLine', () => {
    it('formats with identifier when present', () => {
      expect(formatCopyLine('Asha K', '21001')).toBe('Asha K (21001)');
      expect(formatCopyLine('  Bob  ', ' B12 ')).toBe('Bob (B12)');
    });

    it('formats without identifier when missing, empty or null', () => {
      expect(formatCopyLine('Asha K', null)).toBe('Asha K');
      expect(formatCopyLine('Asha K', undefined)).toBe('Asha K');
      expect(formatCopyLine('Asha K', '')).toBe('Asha K');
      expect(formatCopyLine('Asha K', '   ')).toBe('Asha K');
    });

    it('distinguishes two members with the same name if identifiers differ', () => {
      const line1 = formatCopyLine('Asha K', '21001');
      const line2 = formatCopyLine('Asha K', '21002');
      expect(line1).not.toBe(line2);
      expect(line1).toBe('Asha K (21001)');
      expect(line2).toBe('Asha K (21002)');
    });
  });

  describe('statusLabel', () => {
    it('returns human-readable labels for standard poll statuses', () => {
      expect(statusLabel('at_target')).toBe('Done');
      expect(statusLabel('behind_target')).toBe('Behind');
      expect(statusLabel('excused')).toBe('Excused');
      expect(statusLabel('not_voted')).toBe('Not voted');
      expect(statusLabel('other_status')).toBe('other_status');
    });
  });

  describe('columnValue', () => {
    const row: PollResultRow = {
      member_id: 'm-1',
      display_name: 'Alice',
      identifier: 'A100',
      status: 'at_target',
      selected_options: ['Yes'],
      late: false,
      completed_at: '2026-10-10T12:00:00Z',
      group_values: {
        reg_no: 'A100',
        dept: 'Engineering',
        years: 4,
        empty_field: '',
      },
      answers: {
        expected_ctc: 1200000,
        portfolio: 'https://example.com/alice',
        notes: null,
      },
      answers_updated_at: '2026-10-10T12:00:00Z',
      answers_complete: true,
    };

    it('reads group source values correctly', () => {
      const colDept: PollResultColumn = {
        source: 'group',
        key: 'dept',
        name: 'Department',
        field_type: 'text',
        is_identifier: false,
      };
      expect(columnValue(row, colDept)).toBe('Engineering');

      const colYears: PollResultColumn = {
        source: 'group',
        key: 'years',
        name: 'Years',
        field_type: 'number',
        is_identifier: false,
      };
      expect(columnValue(row, colYears)).toBe('4');
    });

    it('reads poll source values correctly', () => {
      const colCtc: PollResultColumn = {
        source: 'poll',
        key: 'expected_ctc',
        name: 'Expected CTC',
        field_type: 'number',
        is_identifier: false,
      };
      expect(columnValue(row, colCtc)).toBe('1200000');

      const colPort: PollResultColumn = {
        source: 'poll',
        key: 'portfolio',
        name: 'Portfolio Link',
        field_type: 'link',
        is_identifier: false,
      };
      expect(columnValue(row, colPort)).toBe('https://example.com/alice');
    });

    it('returns "-" for missing, null, undefined or empty values', () => {
      const colMissing: PollResultColumn = {
        source: 'group',
        key: 'nonexistent',
        name: 'Missing',
        field_type: 'text',
        is_identifier: false,
      };
      expect(columnValue(row, colMissing)).toBe('-');

      const colNull: PollResultColumn = {
        source: 'poll',
        key: 'notes',
        name: 'Notes',
        field_type: 'text',
        is_identifier: false,
      };
      expect(columnValue(row, colNull)).toBe('-');

      const colEmpty: PollResultColumn = {
        source: 'group',
        key: 'empty_field',
        name: 'Empty',
        field_type: 'text',
        is_identifier: false,
      };
      expect(columnValue(row, colEmpty)).toBe('-');
    });
  });

  describe('filterResultRows', () => {
    const sampleRows: PollResultRow[] = [
      {
        member_id: '1',
        display_name: 'Asha Kumar',
        identifier: '21001',
        status: 'at_target',
        selected_options: ['Completed'],
        late: false,
        completed_at: '2026-10-10T12:00:00Z',
        group_values: { dept: 'Computer Science' },
        answers: { ctc: '20 LPA' },
        answers_updated_at: '2026-10-10T12:00:00Z',
        answers_complete: true,
      },
      {
        member_id: '2',
        display_name: 'Asha K',
        identifier: '21002',
        status: 'behind_target',
        selected_options: ['In progress'],
        late: null,
        completed_at: null,
        group_values: { dept: 'Mechanical' },
        answers: { ctc: '' },
        answers_updated_at: null,
        answers_complete: false,
      },
      {
        member_id: '3',
        display_name: 'David Miller',
        identifier: null,
        status: 'not_voted',
        selected_options: [],
        late: null,
        completed_at: null,
        group_values: { dept: 'Civil' },
        answers: {},
        answers_updated_at: null,
        answers_complete: false,
      },
      {
        member_id: '4',
        display_name: 'Elena Rostova',
        identifier: '21004',
        status: 'excused',
        selected_options: ['Medical leave'],
        late: null,
        completed_at: null,
        group_values: { dept: 'Computer Science' },
        answers: { ctc: '15 LPA' },
        answers_updated_at: '2026-10-10T14:00:00Z',
        answers_complete: true,
      },
    ];

    const columns: PollResultColumn[] = [
      { source: 'group', key: 'dept', name: 'Dept', field_type: 'text', is_identifier: false },
      { source: 'poll', key: 'ctc', name: 'CTC', field_type: 'text', is_identifier: false },
    ];

    it('returns all rows when query is empty and status is "all"', () => {
      const res = filterResultRows(sampleRows, '', 'all', columns);
      expect(res).toHaveLength(4);
    });

    it('filters by status: Done / at_target', () => {
      const res = filterResultRows(sampleRows, '', 'Done', columns);
      expect(res).toHaveLength(1);
      expect(res[0].display_name).toBe('Asha Kumar');
    });

    it('filters by status: Behind / behind_target', () => {
      const res = filterResultRows(sampleRows, '', 'Behind', columns);
      expect(res).toHaveLength(1);
      expect(res[0].display_name).toBe('Asha K');
    });

    it('filters by status: Excused', () => {
      const res = filterResultRows(sampleRows, '', 'Excused', columns);
      expect(res).toHaveLength(1);
      expect(res[0].display_name).toBe('Elena Rostova');
    });

    it('filters by status: Not voted', () => {
      const res = filterResultRows(sampleRows, '', 'Not voted', columns);
      expect(res).toHaveLength(1);
      expect(res[0].display_name).toBe('David Miller');
    });

    it('filters by "Answers incomplete"', () => {
      const res = filterResultRows(sampleRows, '', 'Answers incomplete', columns);
      expect(res).toHaveLength(2);
      expect(res.map((r) => r.display_name)).toEqual(['Asha K', 'David Miller']);
    });

    it('searches by display_name', () => {
      const res = filterResultRows(sampleRows, 'Miller', 'all', columns);
      expect(res).toHaveLength(1);
      expect(res[0].display_name).toBe('David Miller');
    });

    it('searches by identifier', () => {
      const res = filterResultRows(sampleRows, '21002', 'all', columns);
      expect(res).toHaveLength(1);
      expect(res[0].display_name).toBe('Asha K');
    });

    it('searches by group values', () => {
      const res = filterResultRows(sampleRows, 'Mechanical', 'all', columns);
      expect(res).toHaveLength(1);
      expect(res[0].display_name).toBe('Asha K');
    });

    it('searches by poll answer values', () => {
      const res = filterResultRows(sampleRows, '20 LPA', 'all', columns);
      expect(res).toHaveLength(1);
      expect(res[0].display_name).toBe('Asha Kumar');
    });

    it('combines search and status filter', () => {
      const res = filterResultRows(sampleRows, 'Computer Science', 'Done', columns);
      expect(res).toHaveLength(1);
      expect(res[0].display_name).toBe('Asha Kumar');

      const res2 = filterResultRows(sampleRows, 'Computer Science', 'Excused', columns);
      expect(res2).toHaveLength(1);
      expect(res2[0].display_name).toBe('Elena Rostova');
    });
  });
});
