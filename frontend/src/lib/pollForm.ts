import type {
  CompletionTimeMode,
  CreatePollOptionPayload,
  CreatePollPayload,
  PollOptionRole,
} from '../api/types';

export interface PollFormOption {
  id?: string;
  label: string;
  role: PollOptionRole;
}

export interface PollFormValues {
  name: string;
  description: string;
  allowMultiple: boolean;
  deadlineLocal: string;
  completionTimeMode: CompletionTimeMode;
  options: PollFormOption[];
}

export interface PollFieldError {
  field: string;
  message: string;
}

export function validatePollForm(values: PollFormValues): PollFieldError[] {
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

  return errors;
}

export function toCreatePayload(values: PollFormValues): CreatePollPayload {
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

  return {
    name: values.name.trim(),
    description_raw: descTrimmed.length > 0 ? descTrimmed : null,
    allow_multiple: Boolean(values.allowMultiple),
    deadline: deadlineUtc,
    completion_time_mode: values.completionTimeMode || 'last',
    options,
  };
}
