import type { GroupField, GroupMember } from '../api/types';

export interface PaginationResult<T> {
  items: T[];
  total: number;
  totalPages: number;
  page: number;
  start: number;
  end: number;
}

export function validateMemberForm(
  fields: GroupField[],
  values: Record<string, string>,
  name: string,
): Record<string, string> {
  const errors: Record<string, string> = {};

  if (!name.trim()) {
    errors.name = 'Display name is required.';
  }

  for (const f of fields) {
    const raw = values[f.key];
    const val = raw !== undefined && raw !== null ? raw.trim() : '';

    if (f.is_required && !val) {
      errors[f.key] = `${f.name} is required.`;
      continue;
    }

    if (val) {
      if (f.field_type === 'number') {
        const num = Number(val);
        if (Number.isNaN(num)) {
          errors[f.key] = `${f.name} must be a valid number.`;
        }
      } else if (f.field_type === 'link') {
        if (!/^https?:\/\/.+/i.test(val)) {
          errors[f.key] = `${f.name} must be a valid web link starting with http:// or https://.`;
        }
      } else if (f.field_type === 'choice') {
        if (f.choices && !f.choices.includes(val)) {
          errors[f.key] = `${f.name} must be one of the allowed choices.`;
        }
      }
    }
  }

  return errors;
}

export function toMemberPayload(
  fields: GroupField[],
  values: Record<string, string>,
  isEdit = false,
): Record<string, string | number | null> {
  const payload: Record<string, string | number | null> = {};

  for (const f of fields) {
    if (isEdit) {
      // In edit mode: if a field key is present in values, send it
      if (f.key in values) {
        const raw = values[f.key];
        const val = raw !== undefined && raw !== null ? raw.trim() : '';
        if (val === '') {
          // Send empty string to clear and reset to default
          payload[f.key] = '';
        } else if (f.field_type === 'number') {
          payload[f.key] = Number(val);
        } else {
          payload[f.key] = val;
        }
      }
    } else {
      // In create mode: send only non-blank values
      const raw = values[f.key];
      const val = raw !== undefined && raw !== null ? raw.trim() : '';
      if (val !== '') {
        if (f.field_type === 'number') {
          payload[f.key] = Number(val);
        } else {
          payload[f.key] = val;
        }
      }
    }
  }

  return payload;
}

export function filterMembers(
  members: GroupMember[],
  query: string,
  status: string,
): GroupMember[] {
  const q = query.trim().toLowerCase();

  return members.filter((m) => {
    // Status filter
    if (status === 'waiting') {
      if (!m.is_active || m.claim_status !== 'pending') return false;
    } else if (status === 'claimed') {
      if (!m.is_active || m.claim_status !== 'approved') return false;
    } else if (status === 'not_claimed') {
      if (!m.is_active || m.claim_status !== 'unclaimed') return false;
    } else if (status === 'inactive') {
      if (m.is_active) return false;
    }
    // 'all' passes through

    // Search query filter (matches name, identifier, and any custom field value)
    if (!q) return true;

    if (m.display_name.toLowerCase().includes(q)) return true;
    if (m.identifier && m.identifier.toLowerCase().includes(q)) return true;

    if (m.values && typeof m.values === 'object') {
      for (const val of Object.values(m.values)) {
        if (val !== null && val !== undefined) {
          if (String(val).toLowerCase().includes(q)) return true;
        }
      }
    }

    return false;
  });
}

export function paginate<T>(items: T[], page: number, size: number): PaginationResult<T> {
  const total = items.length;
  if (total === 0) {
    return {
      items: [],
      total: 0,
      totalPages: 1,
      page: 1,
      start: 0,
      end: 0,
    };
  }

  const safeSize = Math.max(1, size);
  const totalPages = Math.max(1, Math.ceil(total / safeSize));
  const currentPage = Math.max(1, Math.min(page, totalPages));

  const startIndex = (currentPage - 1) * safeSize;
  const endIndex = Math.min(startIndex + safeSize, total);

  return {
    items: items.slice(startIndex, endIndex),
    total,
    totalPages,
    page: currentPage,
    start: startIndex + 1,
    end: endIndex,
  };
}
