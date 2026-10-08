import type {
  CompletionTimeMode,
  CreatePollOptionPayload,
  CreatePollPayload,
  FieldType,
  GroupField,
  PollOnlyFieldPayload,
  PollOptionRole,
} from '../api/types';

export interface PollFormOption {
  id?: string;
  label: string;
  role: PollOptionRole;
}

export interface PollOnlyFieldDraft {
  id: string;
  name: string;
  field_type: FieldType;
  is_required: boolean;
  default_value: string;
  choicesText: string;
}

export interface PollFormValues {
  name: string;
  description: string;
  allowMultiple: boolean;
  deadlineLocal: string;
  completionTimeMode: CompletionTimeMode;
  options: PollFormOption[];
  includedFieldIds?: string[];
  pollFields?: PollOnlyFieldDraft[];
}

export interface PollFieldError {
  field: string;
  message: string;
}

export function validatePollForm(
  values: PollFormValues,
  groupFields?: GroupField[],
): PollFieldError[] {
  const errors: PollFieldError[] = [];

  const trimmedName = values.name.trim();
  if (!trimmedName) {
    errors.push({ field: 'name', message: 'Poll name is required.' });
  }

  if (!values.options || values.options.length < 2) {
    errors.push({ field: 'options', message: 'Poll must have at least 2 options.' });
  }

  const seenLabels = new Set<string>();
  let hasEmptyLabel = false;
  let hasDuplicateLabel = false;
  let hasTarget = false;

  if (values.options) {
    for (const opt of values.options) {
      const label = opt.label.trim();
      if (!label) {
        hasEmptyLabel = true;
      } else {
        if (seenLabels.has(label)) {
          hasDuplicateLabel = true;
        }
        seenLabels.add(label);
      }

      if (opt.role === 'target') {
        hasTarget = true;
      }
    }
  }

  if (hasEmptyLabel) {
    errors.push({ field: 'options', message: 'Option labels cannot be empty.' });
  }

  if (hasDuplicateLabel) {
    errors.push({ field: 'options', message: 'Option labels must be unique.' });
  }

  if (!hasTarget) {
    errors.push({
      field: 'options',
      message: 'At least one option must have the role "Target (counts as done)".',
    });
  }

  // Poll-only fields validation
  const pollFields = values.pollFields || [];
  if (pollFields.length > 15) {
    errors.push({
      field: 'pollFields',
      message: 'A poll can have at most 15 poll-only fields.',
    });
  }

  // Build forbidden names map (lower case -> description)
  const forbiddenNames = new Map<string, string>();
  if (groupFields) {
    const identifierField = groupFields.find((f) => f.is_identifier);
    if (identifierField) {
      forbiddenNames.set(
        identifierField.name.trim().toLowerCase(),
        'the group identifier field',
      );
    }

    const includedSet = new Set(values.includedFieldIds || []);
    for (const gf of groupFields) {
      if (!gf.is_identifier && includedSet.has(gf.id)) {
        forbiddenNames.set(
          gf.name.trim().toLowerCase(),
          'an included group field',
        );
      }
    }
  }

  const seenPollNames = new Set<string>();

  pollFields.forEach((field, idx) => {
    const cleanName = field.name.trim();
    const nameLower = cleanName.toLowerCase();

    if (!cleanName) {
      errors.push({
        field: `pollFields.${idx}.name`,
        message: 'Question name is required.',
      });
    } else {
      if (seenPollNames.has(nameLower)) {
        errors.push({
          field: `pollFields.${idx}.name`,
          message: `Duplicate question name: "${cleanName}".`,
        });
      } else {
        seenPollNames.add(nameLower);
      }

      if (forbiddenNames.has(nameLower)) {
        errors.push({
          field: `pollFields.${idx}.name`,
          message: `Question name "${cleanName}" conflicts with ${forbiddenNames.get(nameLower)}.`,
        });
      }
    }

    // Type-specific validations
    if (field.field_type === 'choice') {
      const choices = field.choicesText
        .split('\n')
        .map((c) => c.trim())
        .filter(Boolean);

      const uniqueChoices = new Set(choices.map((c) => c.toLowerCase()));

      if (choices.length !== uniqueChoices.size) {
        errors.push({
          field: `pollFields.${idx}.choices`,
          message: 'Choices must be unique.',
        });
      }

      if (uniqueChoices.size < 2 || uniqueChoices.size > 50) {
        errors.push({
          field: `pollFields.${idx}.choices`,
          message: 'Choice questions require 2 to 50 unique choices.',
        });
      }

      const defaultVal = field.default_value.trim();
      if (defaultVal) {
        const matchesChoice = choices.some(
          (c) => c.toLowerCase() === defaultVal.toLowerCase(),
        );
        if (!matchesChoice) {
          errors.push({
            field: `pollFields.${idx}.defaultValue`,
            message: 'Default value must match one of the choices.',
          });
        }
      }
    } else if (field.field_type === 'number') {
      const defaultVal = field.default_value.trim();
      if (defaultVal) {
        const num = Number(defaultVal);
        if (isNaN(num) || !isFinite(num)) {
          errors.push({
            field: `pollFields.${idx}.defaultValue`,
            message: 'Default value must be a valid number.',
          });
        }
      }
    } else if (field.field_type === 'link') {
      const defaultVal = field.default_value.trim();
      if (defaultVal) {
        if (!/^https?:\/\/.+/i.test(defaultVal) || defaultVal.includes(' ')) {
          errors.push({
            field: `pollFields.${idx}.defaultValue`,
            message: 'Default link must start with http:// or https:// and contain no spaces.',
          });
        }
      }
    }
  });

  return errors;
}

export function toCreatePayload(
  values: PollFormValues,
  groupFields?: GroupField[],
): CreatePollPayload {
  let deadlineUtc: string | null = null;
  if (values.deadlineLocal && values.deadlineLocal.trim()) {
    const d = new Date(values.deadlineLocal);
    if (!isNaN(d.getTime())) {
      deadlineUtc = d.toISOString();
    }
  }

  const options: CreatePollOptionPayload[] = values.options.map((opt) => ({
    label: opt.label.trim(),
    role: opt.role,
  }));

  const descTrimmed = values.description.trim();

  const payload: CreatePollPayload = {
    name: values.name.trim(),
    description_raw: descTrimmed.length > 0 ? descTrimmed : null,
    allow_multiple: Boolean(values.allowMultiple),
    deadline: deadlineUtc,
    completion_time_mode: values.completionTimeMode || 'last',
    options,
  };

  // Exclude identifier field ID from included_field_ids
  if (values.includedFieldIds && values.includedFieldIds.length > 0) {
    const identifierId = groupFields?.find((f) => f.is_identifier)?.id;
    const filteredIncluded = values.includedFieldIds.filter(
      (id) => id !== identifierId,
    );
    if (filteredIncluded.length > 0) {
      payload.included_field_ids = filteredIncluded;
    }
  }

  // Format poll_fields if any
  if (values.pollFields && values.pollFields.length > 0) {
    const pollFieldsPayload: PollOnlyFieldPayload[] = values.pollFields.map((f) => {
      const fieldPayload: PollOnlyFieldPayload = {
        name: f.name.trim(),
        field_type: f.field_type,
      };

      if (f.is_required) {
        fieldPayload.is_required = true;
      }

      const trimmedDefault = f.default_value.trim();
      if (trimmedDefault) {
        fieldPayload.default_value = trimmedDefault;
      }

      if (f.field_type === 'choice') {
        const choices = f.choicesText
          .split('\n')
          .map((c) => c.trim())
          .filter(Boolean);
        fieldPayload.choices = choices;
      }

      return fieldPayload;
    });

    payload.poll_fields = pollFieldsPayload;
  }

  return payload;
}
