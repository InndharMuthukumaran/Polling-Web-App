import type { PollResultColumn, PollResultRow } from '../api/types';

/**
 * Returns the readable display label for a poll status code.
 */
export function statusLabel(status: string): string {
  switch (status) {
    case 'at_target':
      return 'Done';
    case 'behind_target':
      return 'Behind';
    case 'excused':
      return 'Excused';
    case 'not_voted':
      return 'Not voted';
    default:
      return status;
  }
}

/**
 * Formats a member's name and optional identifier for clipboard copy.
 * e.g. "Asha K (21001)" or "Asha K"
 */
export function formatCopyLine(name: string, identifier?: string | null): string {
  const trimmedName = name.trim();
  const trimmedId = identifier ? identifier.trim() : '';
  if (trimmedId) {
    return `${trimmedName} (${trimmedId})`;
  }
  return trimmedName;
}

/**
 * Extracts and formats the value of a specific column for a row.
 * Returns "-" for missing/empty values.
 */
export function columnValue(row: PollResultRow, column: PollResultColumn): string {
  let val: unknown = undefined;
  if (column.source === 'group') {
    val = row.group_values ? row.group_values[column.key] : undefined;
  } else if (column.source === 'poll') {
    val = row.answers ? row.answers[column.key] : undefined;
  }

  if (val === undefined || val === null || val === '') {
    return '-';
  }

  return String(val);
}

/**
 * Filters results rows based on text search query and status filter.
 * Search matches name, identifier, and any visible column values or selected options.
 */
export function filterResultRows(
  rows: PollResultRow[],
  query: string,
  statusFilter: string,
  columns?: PollResultColumn[],
): PollResultRow[] {
  const trimmedQuery = query.trim().toLowerCase();
  const normStatus = statusFilter.trim().toLowerCase();

  return rows.filter((row) => {
    // 1. Status Filter
    if (normStatus && normStatus !== 'all') {
      if (normStatus === 'done' || normStatus === 'at_target') {
        if (row.status !== 'at_target') return false;
      } else if (normStatus === 'behind' || normStatus === 'behind_target') {
        if (row.status !== 'behind_target') return false;
      } else if (normStatus === 'excused') {
        if (row.status !== 'excused') return false;
      } else if (
        normStatus === 'not voted' ||
        normStatus === 'not_voted'
      ) {
        if (row.status !== 'not_voted') return false;
      } else if (
        normStatus === 'answers incomplete' ||
        normStatus === 'incomplete'
      ) {
        if (row.answers_complete) return false;
      }
    }

    // 2. Query search
    if (!trimmedQuery) {
      return true;
    }

    if (row.display_name.toLowerCase().includes(trimmedQuery)) {
      return true;
    }

    if (row.identifier && row.identifier.toLowerCase().includes(trimmedQuery)) {
      return true;
    }

    if (statusLabel(row.status).toLowerCase().includes(trimmedQuery)) {
      return true;
    }

    if (
      row.selected_options &&
      row.selected_options.some((opt) => opt.toLowerCase().includes(trimmedQuery))
    ) {
      return true;
    }

    if (columns && columns.length > 0) {
      for (const col of columns) {
        const val = columnValue(row, col);
        if (val !== '-' && val.toLowerCase().includes(trimmedQuery)) {
          return true;
        }
      }
    } else {
      // Check all values in group_values and answers
      if (row.group_values) {
        for (const v of Object.values(row.group_values)) {
          if (v !== null && v !== undefined && String(v).toLowerCase().includes(trimmedQuery)) {
            return true;
          }
        }
      }
      if (row.answers) {
        for (const v of Object.values(row.answers)) {
          if (v !== null && v !== undefined && String(v).toLowerCase().includes(trimmedQuery)) {
            return true;
          }
        }
      }
    }

    return false;
  });
}
