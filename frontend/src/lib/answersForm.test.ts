import { describe, expect, it } from 'vitest';
import {
  initialAnswerValues,
  toAnswersPayload,
  validateAnswers,
} from './answersForm';
import type { PublicPollField } from '../api/types';

describe('answersForm helpers', () => {
  const sampleFields: PublicPollField[] = [
    {
      key: 'expected_ctc',
      name: 'Expected CTC',
      field_type: 'number',
      is_required: true,
      default_value: '10.5',
      choices: null,
      position: 1,
    },
    {
      key: 'preferred_location',
      name: 'Preferred Location',
      field_type: 'choice',
      is_required: false,
      default_value: 'Bangalore',
      choices: ['Bangalore', 'Chennai', 'Remote'],
      position: 2,
    },
    {
      key: 'portfolio',
      name: 'Portfolio Link',
      field_type: 'link',
      is_required: false,
      default_value: null,
      choices: null,
      position: 3,
    },
    {
      key: 'notes',
      name: 'Notes',
      field_type: 'text',
      is_required: false,
      default_value: 'None',
      choices: null,
      position: 4,
    },
  ];

  describe('initialAnswerValues', () => {
    it('pre-fills defaults when nothing is saved', () => {
      const values = initialAnswerValues(sampleFields, null);
      expect(values).toEqual({
        expected_ctc: '10.5',
        preferred_location: 'Bangalore',
        portfolio: '',
        notes: 'None',
      });
    });

    it('saved values win over field defaults', () => {
      const saved = {
        expected_ctc: 15,
        preferred_location: 'Remote',
        notes: 'Special consideration',
      };
      const values = initialAnswerValues(sampleFields, saved);
      expect(values).toEqual({
        expected_ctc: '15',
        preferred_location: 'Remote',
        portfolio: '',
        notes: 'Special consideration',
      });
    });

    it('handles empty saved object by using defaults', () => {
      const values = initialAnswerValues(sampleFields, {});
      expect(values).toEqual({
        expected_ctc: '10.5',
        preferred_location: 'Bangalore',
        portfolio: '',
        notes: 'None',
      });
    });
  });

  describe('validateAnswers', () => {
    it('catches missing required fields', () => {
      const values = {
        expected_ctc: '',
        preferred_location: 'Bangalore',
        portfolio: '',
        notes: '',
      };
      const errors = validateAnswers(sampleFields, values);
      expect(errors.expected_ctc).toBe('Expected CTC is required.');
    });

    it('validates number field format', () => {
      const invalid = validateAnswers(sampleFields, {
        expected_ctc: 'not-a-number',
      });
      expect(invalid.expected_ctc).toBe('Expected CTC must be a valid number.');

      const validDecimal = validateAnswers(sampleFields, {
        expected_ctc: '12.5',
      });
      expect(validDecimal.expected_ctc).toBeUndefined();

      const validInteger = validateAnswers(sampleFields, {
        expected_ctc: '42',
      });
      expect(validInteger.expected_ctc).toBeUndefined();
    });

    it('validates link field format', () => {
      const missingProtocol = validateAnswers(sampleFields, {
        expected_ctc: '10',
        portfolio: 'www.example.com',
      });
      expect(missingProtocol.portfolio).toBe('Portfolio Link must start with http:// or https://.');

      const withWhitespace = validateAnswers(sampleFields, {
        expected_ctc: '10',
        portfolio: 'https:// example.com',
      });
      expect(withWhitespace.portfolio).toBe('Portfolio Link must start with http:// or https://.');

      const validLink = validateAnswers(sampleFields, {
        expected_ctc: '10',
        portfolio: 'https://example.com/portfolio',
      });
      expect(validLink.portfolio).toBeUndefined();
    });

    it('validates choice field matches allowed options', () => {
      const invalidChoice = validateAnswers(sampleFields, {
        expected_ctc: '10',
        preferred_location: 'Hyderabad',
      });
      expect(invalidChoice.preferred_location).toBe('Preferred Location must be one of the provided options.');

      const validChoice = validateAnswers(sampleFields, {
        expected_ctc: '10',
        preferred_location: 'chennai', // case-insensitive match
      });
      expect(validChoice.preferred_location).toBeUndefined();
    });

    it('validates text field length limit', () => {
      const longText = 'a'.repeat(501);
      const errors = validateAnswers(sampleFields, {
        expected_ctc: '10',
        notes: longText,
      });
      expect(errors.notes).toBe('Notes cannot exceed 500 characters.');
    });

    it('returns empty error map when all inputs are valid', () => {
      const valid = {
        expected_ctc: '15.5',
        preferred_location: 'Remote',
        portfolio: 'https://github.com/alice',
        notes: 'Looking forward to it',
      };
      const errors = validateAnswers(sampleFields, valid);
      expect(Object.keys(errors)).toHaveLength(0);
    });
  });

  describe('toAnswersPayload', () => {
    it('includes every field, converts numbers, and sends blank as empty string', () => {
      const values = {
        expected_ctc: ' 18.5 ',
        preferred_location: 'Remote',
        portfolio: '',
        notes: '  Some text  ',
      };
      const payload = toAnswersPayload(sampleFields, values);
      expect(payload).toEqual({
        expected_ctc: 18.5,
        preferred_location: 'Remote',
        portfolio: '',
        notes: 'Some text',
      });
    });

    it('converts blank number fields to empty string', () => {
      const values = {
        expected_ctc: '   ',
        preferred_location: '',
        portfolio: '',
        notes: '',
      };
      const payload = toAnswersPayload(sampleFields, values);
      expect(payload).toEqual({
        expected_ctc: '',
        preferred_location: '',
        portfolio: '',
        notes: '',
      });
    });
  });
});
