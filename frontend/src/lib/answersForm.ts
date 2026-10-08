import type { PublicPollField } from '../api/types';

/**
 * Returns initial form values for poll-only fields.
 * Saved answers take precedence; if not saved, pre-fills default_value or empty string.
 */
export function initialAnswerValues(
  pollFields: PublicPollField[],
  saved?: Record<string, unknown> | null,
): Record<string, string> {
  const result: Record<string, string> = {};

  for (const field of pollFields) {
    if (saved && saved[field.key] !== undefined && saved[field.key] !== null) {
      result[field.key] = String(saved[field.key]);
    } else if (field.default_value !== null && field.default_value !== undefined) {
      result[field.key] = String(field.default_value);
    } else {
      result[field.key] = '';
    }
  }

  return result;
}

/**
 * Validates member answers client-side before sending.
 * Returns a dictionary of field-level error messages keyed by field.key.
 */
export function validateAnswers(
  pollFields: PublicPollField[],
  values: Record<string, string>,
): Record<string, string> {
  const errors: Record<string, string> = {};

  for (const field of pollFields) {
    const raw = values[field.key] ?? '';
    const val = typeof raw === 'string' ? raw.trim() : String(raw).trim();

    if (field.is_required && !val) {
      errors[field.key] = `${field.name} is required.`;
      continue;
    }

    if (val) {
      if (field.field_type === 'number') {
        const num = Number(val);
        if (Number.isNaN(num) || !Number.isFinite(num)) {
          errors[field.key] = `${field.name} must be a valid number.`;
        }
      } else if (field.field_type === 'link') {
        if ((!val.startsWith('http://') && !val.startsWith('https://')) || /\s/.test(val) || val.length > 2000) {
          errors[field.key] = `${field.name} must start with http:// or https://.`;
        }
      } else if (field.field_type === 'choice') {
        if (field.choices && field.choices.length > 0) {
          const found = field.choices.some((c) => c.toLowerCase() === val.toLowerCase());
          if (!found) {
            errors[field.key] = `${field.name} must be one of the provided options.`;
          }
        }
      } else if (field.field_type === 'text') {
        if (val.length > 500) {
          errors[field.key] = `${field.name} cannot exceed 500 characters.`;
        }
      }
    }
  }

  return errors;
}

/**
 * Transforms form values into the payload sent to PUT /polls/{id}/answers.
 * Ensures every field is included (blank string for empty values), and converts
 * valid numbers to numeric values.
 */
export function toAnswersPayload(
  pollFields: PublicPollField[],
  values: Record<string, string>,
): Record<string, string | number> {
  const payload: Record<string, string | number> = {};

  for (const field of pollFields) {
    const raw = values[field.key] ?? '';
    const val = typeof raw === 'string' ? raw.trim() : String(raw).trim();

    if (!val) {
      payload[field.key] = '';
    } else if (field.field_type === 'number') {
      const num = Number(val);
      payload[field.key] = Number.isNaN(num) ? val : num;
    } else {
      payload[field.key] = val;
    }
  }

  return payload;
}
