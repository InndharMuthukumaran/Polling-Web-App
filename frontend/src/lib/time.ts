/**
 * Utilities for formatting dates and calculating human-friendly deadline descriptions.
 */

export function formatDateTime(iso: string): string {
  const date = new Date(iso);
  if (isNaN(date.getTime())) return '';

  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date);
}

export function formatTimeOnly(date: Date): string {
  return new Intl.DateTimeFormat(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  }).format(date);
}

export function describeDeadline(iso: string | null | undefined, now: Date = new Date()): string {
  if (!iso) {
    return 'No deadline';
  }

  const target = new Date(iso);
  if (isNaN(target.getTime())) {
    return '';
  }

  const diffMs = target.getTime() - now.getTime();

  // Past deadline
  if (diffMs < 0) {
    const elapsedMs = Math.abs(diffMs);
    const elapsedMinutes = Math.floor(elapsedMs / (1000 * 60));
    const elapsedHours = Math.floor(elapsedMs / (1000 * 60 * 60));
    const elapsedDays = Math.floor(elapsedMs / (1000 * 60 * 60 * 24));

    if (elapsedMinutes < 1) {
      return 'Deadline just passed';
    }
    if (elapsedHours < 1) {
      return `Deadline passed ${elapsedMinutes} minute${elapsedMinutes === 1 ? '' : 's'} ago`;
    }
    if (elapsedHours < 24) {
      return `Deadline passed ${elapsedHours} hour${elapsedHours === 1 ? '' : 's'} ago`;
    }
    return `Deadline passed ${elapsedDays} day${elapsedDays === 1 ? '' : 's'} ago`;
  }

  // Future deadline
  const remainingMinutes = Math.floor(diffMs / (1000 * 60));
  const remainingHours = Math.floor(diffMs / (1000 * 60 * 60));

  const targetDateStr = target.toDateString();
  const nowDateStr = now.toDateString();
  const tomorrow = new Date(now);
  tomorrow.setDate(now.getDate() + 1);
  const tomorrowDateStr = tomorrow.toDateString();

  const isToday = targetDateStr === nowDateStr;
  const isTomorrow = targetDateStr === tomorrowDateStr;
  const timeFormatted = formatTimeOnly(target);

  if (remainingMinutes < 1) {
    return 'Due in less than a minute';
  }
  if (remainingHours < 1) {
    return `Due in ${remainingMinutes} minute${remainingMinutes === 1 ? '' : 's'}`;
  }
  if (isToday) {
    return `Due in ${remainingHours} hour${remainingHours === 1 ? '' : 's'}`;
  }
  if (isTomorrow) {
    return `Due tomorrow at ${timeFormatted}`;
  }

  const monthDay = new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
  }).format(target);
  return `Due ${monthDay} at ${timeFormatted}`;
}
