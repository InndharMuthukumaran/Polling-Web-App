import { describe, expect, it } from 'vitest';
import type { GroupField } from '../api/types';
import { buildImportRequest, type ColumnChoice } from './importMapping';

describe('importMapping.ts', () => {
  const existingFields: GroupField[] = [
    {
      id: 'f-1',
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
      id: 'f-2',
      key: 'department',
      name: 'Department',
      field_type: 'choice',
      is_required: false,
      default_value: 'CS',
      choices: ['CS', 'EE'],
      is_identifier: false,
      position: 2,
    },
  ];

  const columns = [
    { index: 0, header: 'Full Name' },
    { index: 1, header: 'RegNo' },
    { index: 2, header: 'Dept' },
    { index: 3, header: 'Unneeded' },
  ];

  it('builds a valid mapping request with existing fields and skips', () => {
    const choices: Record<number, ColumnChoice> = {
      0: { type: 'name' },
      1: { type: 'field', fieldKey: 'reg_no' },
      2: { type: 'field', fieldKey: 'department' },
      3: { type: 'skip' },
    };

    const res = buildImportRequest(columns, choices, existingFields, false);
    expect(res.problems).toHaveLength(0);
    expect(res.mapping).toEqual({
      '0': 'name',
      '1': 'reg_no',
      '2': 'department',
      '3': 'skip',
    });
    expect(res.newFields).toBeUndefined();
  });

  it('columns turned into new fields appear as "skip" in mapping and populate newFields', () => {
    const cols = [
      { index: 0, header: 'Name' },
      { index: 1, header: 'Phone' },
    ];
    const choices: Record<number, ColumnChoice> = {
      0: { type: 'name' },
      1: {
        type: 'new',
        newField: {
          name: 'Mobile Phone',
          field_type: 'text',
          is_required: false,
        },
      },
    };

    const res = buildImportRequest(cols, choices, existingFields, false);
    expect(res.problems).toHaveLength(0);
    expect(res.mapping).toEqual({
      '0': 'name',
      '1': 'skip',
    });
    expect(res.newFields).toEqual([
      {
        column: 1,
        name: 'Mobile Phone',
        field_type: 'text',
        is_required: false,
        default_value: null,
        choices: undefined,
        is_identifier: undefined,
      },
    ]);
  });

  it('rejects when no column is mapped to Name', () => {
    const choices: Record<number, ColumnChoice> = {
      0: { type: 'skip' },
      1: { type: 'field', fieldKey: 'reg_no' },
    };
    const res = buildImportRequest(columns.slice(0, 2), choices, existingFields, false);
    expect(res.problems).toContain('Exactly one column must be mapped to Name.');
  });

  it('rejects when more than one column is mapped to Name', () => {
    const choices: Record<number, ColumnChoice> = {
      0: { type: 'name' },
      1: { type: 'name' },
    };
    const res = buildImportRequest(columns.slice(0, 2), choices, existingFields, false);
    expect(res.problems).toContain('Only one column can be mapped to Name.');
  });

  it('rejects when two columns share the same field target', () => {
    const choices: Record<number, ColumnChoice> = {
      0: { type: 'name' },
      1: { type: 'field', fieldKey: 'reg_no' },
      2: { type: 'field', fieldKey: 'reg_no' },
    };
    const res = buildImportRequest(columns.slice(0, 3), choices, existingFields, false);
    expect(res.problems.some((p) => p.includes('Multiple columns are mapped to the same field'))).toBe(true);
  });

  it('rejects new field with empty name or duplicate names', () => {
    const cols = [
      { index: 0, header: 'Name' },
      { index: 1, header: 'Col1' },
      { index: 2, header: 'Col2' },
      { index: 3, header: 'Col3' },
    ];
    const choices: Record<number, ColumnChoice> = {
      0: { type: 'name' },
      1: { type: 'new', newField: { name: '   ', field_type: 'text' } }, // empty
      2: { type: 'new', newField: { name: 'Register No', field_type: 'text' } }, // exists in existingFields
      3: { type: 'new', newField: { name: 'register no', field_type: 'text' } }, // duplicate new
    };

    const res = buildImportRequest(cols, choices, existingFields, false);
    expect(res.problems.some((p) => p.includes('must have a name'))).toBe(true);
    expect(res.problems.some((p) => p.includes('already exists in the group'))).toBe(true);
    expect(res.problems.some((p) => p.includes('Duplicate new field name'))).toBe(true);
  });

  it('rejects choice field with fewer than 2 choices', () => {
    const cols = [
      { index: 0, header: 'Name' },
      { index: 1, header: 'Color' },
    ];
    const choices: Record<number, ColumnChoice> = {
      0: { type: 'name' },
      1: {
        type: 'new',
        newField: {
          name: 'Color',
          field_type: 'choice',
          choices: ['Red'],
        },
      },
    };
    const res = buildImportRequest(cols, choices, existingFields, false);
    expect(res.problems.some((p) => p.includes('must have at least 2 choices'))).toBe(true);
  });

  it('allows identifier in new field only on first upload when canBeIdentifier is true', () => {
    const cols = [
      { index: 0, header: 'Name' },
      { index: 1, header: 'ID' },
    ];
    const choices: Record<number, ColumnChoice> = {
      0: { type: 'name' },
      1: {
        type: 'new',
        newField: {
          name: 'ID Code',
          field_type: 'text',
          is_identifier: true,
        },
      },
    };

    // When canBeIdentifier is false -> rejected
    const resForbidden = buildImportRequest(cols, choices, [], false);
    expect(resForbidden.problems.some((p) => p.includes('Cannot set "ID Code" as identifier'))).toBe(true);

    // When canBeIdentifier is true -> accepted
    const resAllowed = buildImportRequest(cols, choices, [], true);
    expect(resAllowed.problems).toHaveLength(0);
    expect(resAllowed.newFields?.[0].is_identifier).toBe(true);
  });
});
