import { describe, expect, it } from 'vitest';
import type { GroupField } from '../api/types';
import {
  toCreatePayload,
  validatePollForm,
  type PollFormValues,
  type PollOnlyFieldDraft,
} from './pollForm';

describe('pollForm.ts', () => {
  const baseValidValues: PollFormValues = {
    name: 'Team Lunch',
    description: 'Where should we go?',
    allowMultiple: false,
    deadlineLocal: '2026-10-15T14:30',
    completionTimeMode: 'last',
    options: [
      { label: 'Pizza', role: 'target' },
      { label: 'Sushi', role: 'not_yet' },
    ],
  };

  const sampleGroupFields: GroupField[] = [
    {
      id: 'f-id',
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
      key: 'department',
      name: 'Department',
      field_type: 'choice',
      is_required: false,
      default_value: 'CS',
      choices: ['CS', 'ME', 'EE'],
      is_identifier: false,
      position: 2,
    },
    {
      id: 'f-extra',
      key: 'extra_info',
      name: 'Extra Info',
      field_type: 'text',
      is_required: false,
      default_value: null,
      choices: null,
      is_identifier: false,
      position: 3,
    },
  ];

  describe('validatePollForm', () => {
    it('passes for a valid form with basic options', () => {
      const errors = validatePollForm(baseValidValues);
      expect(errors).toHaveLength(0);
    });

    it('fails when poll name is empty or only whitespace', () => {
      const errors = validatePollForm({ ...baseValidValues, name: '   ' });
      expect(errors).toContainEqual({
        field: 'name',
        message: 'Poll name is required.',
      });
    });

    it('fails when fewer than 2 options are provided', () => {
      const errors = validatePollForm({
        ...baseValidValues,
        options: [{ label: 'Only One', role: 'target' }],
      });
      expect(errors).toContainEqual({
        field: 'options',
        message: 'Poll must have at least 2 options.',
      });
    });

    it('fails when an option label is empty or only whitespace', () => {
      const errors = validatePollForm({
        ...baseValidValues,
        options: [
          { label: 'Target', role: 'target' },
          { label: '  ', role: 'not_yet' },
        ],
      });
      expect(errors).toContainEqual({
        field: 'options',
        message: 'Option labels cannot be empty.',
      });
    });

    it('fails when option labels are duplicated', () => {
      const errors = validatePollForm({
        ...baseValidValues,
        options: [
          { label: 'Same Option', role: 'target' },
          { label: 'Same Option', role: 'not_yet' },
        ],
      });
      expect(errors).toContainEqual({
        field: 'options',
        message: 'Option labels must be unique.',
      });
    });

    it('fails when no option has the target role', () => {
      const errors = validatePollForm({
        ...baseValidValues,
        options: [
          { label: 'Option 1', role: 'in_progress' },
          { label: 'Option 2', role: 'not_yet' },
        ],
      });
      expect(errors).toContainEqual({
        field: 'options',
        message: 'At least one option must have the role "Target (counts as done)".',
      });
    });

    // New validation rules for poll-only fields
    it('fails when poll-only question name is empty', () => {
      const pollFields: PollOnlyFieldDraft[] = [
        {
          id: '1',
          name: '   ',
          field_type: 'text',
          is_required: false,
          default_value: '',
          choicesText: '',
        },
      ];
      const errors = validatePollForm({ ...baseValidValues, pollFields });
      expect(errors).toContainEqual({
        field: 'pollFields.0.name',
        message: 'Question name is required.',
      });
    });

    it('fails when poll-only question names are duplicated ignoring case', () => {
      const pollFields: PollOnlyFieldDraft[] = [
        {
          id: '1',
          name: 'Location',
          field_type: 'text',
          is_required: false,
          default_value: '',
          choicesText: '',
        },
        {
          id: '2',
          name: 'location',
          field_type: 'text',
          is_required: false,
          default_value: '',
          choicesText: '',
        },
      ];
      const errors = validatePollForm({ ...baseValidValues, pollFields });
      expect(errors).toContainEqual({
        field: 'pollFields.1.name',
        message: 'Duplicate question name: "location".',
      });
    });

    it('fails when poll-only question name clashes with identifier field name', () => {
      const pollFields: PollOnlyFieldDraft[] = [
        {
          id: '1',
          name: 'register no',
          field_type: 'text',
          is_required: false,
          default_value: '',
          choicesText: '',
        },
      ];
      const errors = validatePollForm(
        { ...baseValidValues, pollFields },
        sampleGroupFields,
      );
      expect(errors).toContainEqual({
        field: 'pollFields.0.name',
        message: 'Question name "register no" conflicts with the group identifier field.',
      });
    });

    it('fails when poll-only question name clashes with checked included field name', () => {
      const pollFields: PollOnlyFieldDraft[] = [
        {
          id: '1',
          name: 'DEPARTMENT',
          field_type: 'text',
          is_required: false,
          default_value: '',
          choicesText: '',
        },
      ];
      const errors = validatePollForm(
        { ...baseValidValues, includedFieldIds: ['f-dept'], pollFields },
        sampleGroupFields,
      );
      expect(errors).toContainEqual({
        field: 'pollFields.0.name',
        message: 'Question name "DEPARTMENT" conflicts with an included group field.',
      });
    });

    it('permits poll-only question name if matching group field is NOT included', () => {
      const pollFields: PollOnlyFieldDraft[] = [
        {
          id: '1',
          name: 'Extra Info',
          field_type: 'text',
          is_required: false,
          default_value: '',
          choicesText: '',
        },
      ];
      // f-extra is not in includedFieldIds
      const errors = validatePollForm(
        { ...baseValidValues, includedFieldIds: ['f-dept'], pollFields },
        sampleGroupFields,
      );
      expect(errors).toHaveLength(0);
    });

    it('fails when choice field has fewer than 2 choices or duplicate choices', () => {
      const pollFields: PollOnlyFieldDraft[] = [
        {
          id: '1',
          name: 'T-Shirt Size',
          field_type: 'choice',
          is_required: false,
          default_value: '',
          choicesText: 'Small',
        },
      ];
      const errors1 = validatePollForm({ ...baseValidValues, pollFields });
      expect(errors1).toContainEqual({
        field: 'pollFields.0.choices',
        message: 'Choice questions require 2 to 50 unique choices.',
      });

      const pollFieldsDup: PollOnlyFieldDraft[] = [
        {
          id: '1',
          name: 'T-Shirt Size',
          field_type: 'choice',
          is_required: false,
          default_value: '',
          choicesText: 'Small\nSmall',
        },
      ];
      const errors2 = validatePollForm({ ...baseValidValues, pollFields: pollFieldsDup });
      expect(errors2).toContainEqual({
        field: 'pollFields.0.choices',
        message: 'Choices must be unique.',
      });
    });

    it('validates default values according to field type', () => {
      // Choice default not in choices
      const badChoice: PollOnlyFieldDraft[] = [
        {
          id: '1',
          name: 'Color',
          field_type: 'choice',
          is_required: false,
          default_value: 'Yellow',
          choicesText: 'Red\nBlue',
        },
      ];
      expect(validatePollForm({ ...baseValidValues, pollFields: badChoice })).toContainEqual({
        field: 'pollFields.0.defaultValue',
        message: 'Default value must match one of the choices.',
      });

      // Number default invalid
      const badNumber: PollOnlyFieldDraft[] = [
        {
          id: '1',
          name: 'Age',
          field_type: 'number',
          is_required: false,
          default_value: 'not-a-number',
          choicesText: '',
        },
      ];
      expect(validatePollForm({ ...baseValidValues, pollFields: badNumber })).toContainEqual({
        field: 'pollFields.0.defaultValue',
        message: 'Default value must be a valid number.',
      });

      // Link default invalid
      const badLink: PollOnlyFieldDraft[] = [
        {
          id: '1',
          name: 'Website',
          field_type: 'link',
          is_required: false,
          default_value: 'example.com',
          choicesText: '',
        },
      ];
      expect(validatePollForm({ ...baseValidValues, pollFields: badLink })).toContainEqual({
        field: 'pollFields.0.defaultValue',
        message: 'Default link must start with http:// or https:// and contain no spaces.',
      });
    });

    it('fails when more than 15 poll-only fields are added', () => {
      const pollFields: PollOnlyFieldDraft[] = Array.from({ length: 16 }, (_, i) => ({
        id: `field-${i}`,
        name: `Question ${i + 1}`,
        field_type: 'text',
        is_required: false,
        default_value: '',
        choicesText: '',
      }));

      const errors = validatePollForm({ ...baseValidValues, pollFields });
      expect(errors).toContainEqual({
        field: 'pollFields',
        message: 'A poll can have at most 15 poll-only fields.',
      });
    });
  });

  describe('toCreatePayload', () => {
    it('converts deadline to UTC ISO and explicitly includes completion_time_mode', () => {
      const payload = toCreatePayload(baseValidValues);

      expect(payload.name).toBe('Team Lunch');
      expect(payload.description_raw).toBe('Where should we go?');
      expect(payload.allow_multiple).toBe(false);
      expect(payload.completion_time_mode).toBe('last');
      expect(payload.options).toEqual([
        { label: 'Pizza', role: 'target' },
        { label: 'Sushi', role: 'not_yet' },
      ]);
      expect(payload.deadline).toBe(new Date('2026-10-15T14:30').toISOString());
      expect(payload.included_field_ids).toBeUndefined();
      expect(payload.poll_fields).toBeUndefined();
    });

    it('handles missing or empty deadline properly as null', () => {
      const payload = toCreatePayload({
        ...baseValidValues,
        deadlineLocal: '',
        description: '   ',
        completionTimeMode: 'first',
      });

      expect(payload.deadline).toBeNull();
      expect(payload.description_raw).toBeNull();
      expect(payload.completion_time_mode).toBe('first');
    });

    it('excludes identifier field from included_field_ids and omits key when empty', () => {
      // 1. Only identifier selected -> omitted
      const payload1 = toCreatePayload(
        { ...baseValidValues, includedFieldIds: ['f-id'] },
        sampleGroupFields,
      );
      expect(payload1.included_field_ids).toBeUndefined();

      // 2. Identifier + other field selected -> only other field included
      const payload2 = toCreatePayload(
        { ...baseValidValues, includedFieldIds: ['f-id', 'f-dept'] },
        sampleGroupFields,
      );
      expect(payload2.included_field_ids).toEqual(['f-dept']);
    });

    it('formats poll_fields payload properly and parses choices', () => {
      const pollFields: PollOnlyFieldDraft[] = [
        {
          id: '1',
          name: 'Preferred Location',
          field_type: 'choice',
          is_required: true,
          default_value: 'Bangalore',
          choicesText: 'Bangalore\nHyderabad\nPune',
        },
        {
          id: '2',
          name: 'Expected CTC',
          field_type: 'number',
          is_required: false,
          default_value: '1500000',
          choicesText: '',
        },
        {
          id: '3',
          name: 'GitHub Profile',
          field_type: 'link',
          is_required: false,
          default_value: '',
          choicesText: '',
        },
      ];

      const payload = toCreatePayload({ ...baseValidValues, pollFields });
      expect(payload.poll_fields).toEqual([
        {
          name: 'Preferred Location',
          field_type: 'choice',
          is_required: true,
          default_value: 'Bangalore',
          choicesText: undefined,
          choices: ['Bangalore', 'Hyderabad', 'Pune'],
        },
        {
          name: 'Expected CTC',
          field_type: 'number',
          default_value: '1500000',
        },
        {
          name: 'GitHub Profile',
          field_type: 'link',
        },
      ]);
    });
  });
});
