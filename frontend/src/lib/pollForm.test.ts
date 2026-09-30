import { describe, expect, it } from 'vitest';
import {
  toCreatePayload,
  validatePollForm,
  type PollFormValues,
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

  describe('validatePollForm', () => {
    it('passes for a valid form', () => {
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
  });
});
