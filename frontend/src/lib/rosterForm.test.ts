import { describe, expect, it } from 'vitest';
import type { GroupField, GroupMember } from '../api/types';
import {
  filterMembers,
  paginate,
  toMemberPayload,
  validateMemberForm,
} from './rosterForm';

describe('rosterForm.ts', () => {
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
      id: 'f-age',
      key: 'age',
      name: 'Age',
      field_type: 'number',
      is_required: false,
      default_value: '18',
      choices: null,
      is_identifier: false,
      position: 2,
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
      position: 3,
    },
    {
      id: 'f-web',
      key: 'website',
      name: 'Website',
      field_type: 'link',
      is_required: false,
      default_value: null,
      choices: null,
      is_identifier: false,
      position: 4,
    },
  ];

  describe('validateMemberForm', () => {
    it('validates required name and required fields', () => {
      const errorsEmpty = validateMemberForm(mockFields, {}, '');
      expect(errorsEmpty.name).toBe('Display name is required.');
      expect(errorsEmpty.reg_no).toBe('Register No is required.');
    });

    it('validates each field type: number, link, choice', () => {
      // Invalid number, invalid link, invalid choice
      const invalidValues = {
        reg_no: 'REG101',
        age: 'twenty',
        website: 'ftp://not-web.com',
        dept: 'Arts',
      };
      const errors = validateMemberForm(mockFields, invalidValues, 'Alice');
      expect(errors.name).toBeUndefined();
      expect(errors.reg_no).toBeUndefined();
      expect(errors.age).toBe('Age must be a valid number.');
      expect(errors.website).toBe('Website must be a valid web link starting with http:// or https://.');
      expect(errors.dept).toBe('Department must be one of the allowed choices.');

      // Valid values
      const validValues = {
        reg_no: 'REG101',
        age: '21',
        website: 'https://example.com/alice',
        dept: 'CS',
      };
      const validErrors = validateMemberForm(mockFields, validValues, 'Alice');
      expect(Object.keys(validErrors)).toHaveLength(0);
    });
  });

  describe('toMemberPayload', () => {
    it('in create mode sends only non-blank values and casts numbers', () => {
      const values = {
        reg_no: 'REG001',
        age: '22',
        dept: '   ',
        website: '',
      };
      const payload = toMemberPayload(mockFields, values, false);
      expect(payload).toEqual({
        reg_no: 'REG001',
        age: 22,
      });
      expect(payload.dept).toBeUndefined();
      expect(payload.website).toBeUndefined();
    });

    it('in edit mode sends cleared values as empty string to reset defaults', () => {
      const values = {
        reg_no: 'REG002',
        age: '', // cleared
        dept: 'EE',
        website: '   ', // cleared
      };
      const payload = toMemberPayload(mockFields, values, true);
      expect(payload).toEqual({
        reg_no: 'REG002',
        age: '',
        dept: 'EE',
        website: '',
      });
    });
  });

  describe('filterMembers', () => {
    const members: GroupMember[] = [
      {
        id: '1',
        display_name: 'Alice Smith',
        is_active: true,
        claim_status: 'approved',
        identifier: 'REG01',
        values: { dept: 'CS', city: 'London' },
      },
      {
        id: '2',
        display_name: 'Bob Jones',
        is_active: true,
        claim_status: 'pending',
        identifier: 'REG02',
        values: { dept: 'EE', city: 'Paris' },
      },
      {
        id: '3',
        display_name: 'Charlie Brown',
        is_active: true,
        claim_status: 'unclaimed',
        identifier: 'REG03',
        values: { dept: 'ME', city: 'London' },
      },
      {
        id: '4',
        display_name: 'David Inactive',
        is_active: false,
        claim_status: 'unclaimed',
        identifier: 'REG04',
        values: { dept: 'CS', city: 'Berlin' },
      },
    ];

    it('filters by status correctly', () => {
      expect(filterMembers(members, '', 'all')).toHaveLength(4);
      expect(filterMembers(members, '', 'claimed')).toEqual([members[0]]);
      expect(filterMembers(members, '', 'waiting')).toEqual([members[1]]);
      expect(filterMembers(members, '', 'not_claimed')).toEqual([members[2]]);
      expect(filterMembers(members, '', 'inactive')).toEqual([members[3]]);
    });

    it('searches across display_name, identifier, and custom field values', () => {
      // By name
      expect(filterMembers(members, 'alice', 'all')).toEqual([members[0]]);
      // By identifier
      expect(filterMembers(members, 'reg02', 'all')).toEqual([members[1]]);
      // By value in values dict ('London')
      const londonMembers = filterMembers(members, 'london', 'all');
      expect(londonMembers).toEqual([members[0], members[2]]);
      // Search with status
      expect(filterMembers(members, 'london', 'claimed')).toEqual([members[0]]);
    });
  });

  describe('paginate', () => {
    const list = Array.from({ length: 125 }, (_, i) => `item-${i + 1}`);

    it('paginates across boundaries', () => {
      // Page 1 (size 50)
      const p1 = paginate(list, 1, 50);
      expect(p1.total).toBe(125);
      expect(p1.totalPages).toBe(3);
      expect(p1.items).toHaveLength(50);
      expect(p1.start).toBe(1);
      expect(p1.end).toBe(50);
      expect(p1.items[0]).toBe('item-1');
      expect(p1.items[49]).toBe('item-50');

      // Page 2
      const p2 = paginate(list, 2, 50);
      expect(p2.items).toHaveLength(50);
      expect(p2.start).toBe(51);
      expect(p2.end).toBe(100);

      // Page 3
      const p3 = paginate(list, 3, 50);
      expect(p3.items).toHaveLength(25);
      expect(p3.start).toBe(101);
      expect(p3.end).toBe(125);
      expect(p3.items[24]).toBe('item-125');

      // Beyond page boundary clamps to max page
      const p4 = paginate(list, 10, 50);
      expect(p4.page).toBe(3);
      expect(p4.items).toHaveLength(25);
    });

    it('handles empty list gracefully', () => {
      const empty = paginate([], 1, 50);
      expect(empty.total).toBe(0);
      expect(empty.totalPages).toBe(1);
      expect(empty.start).toBe(0);
      expect(empty.end).toBe(0);
      expect(empty.items).toEqual([]);
    });
  });
});
