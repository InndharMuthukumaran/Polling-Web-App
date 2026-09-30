import { describe, expect, it } from 'vitest';
import { describeDeadline, formatDateTime } from './time';

describe('time.ts', () => {
  // Use a fixed reference point: 2026-10-15T12:00:00Z
  const fixedNow = new Date('2026-10-15T12:00:00Z');

  describe('describeDeadline', () => {
    it('returns "No deadline" for null, undefined, or empty values', () => {
      expect(describeDeadline(null, fixedNow)).toBe('No deadline');
      expect(describeDeadline(undefined, fixedNow)).toBe('No deadline');
      expect(describeDeadline('', fixedNow)).toBe('No deadline');
    });

    it('handles same-day future deadlines (hours)', () => {
      // 2 hours in future on the same calendar day
      const futureTwoHours = new Date(fixedNow.getTime() + 2 * 60 * 60 * 1000).toISOString();
      expect(describeDeadline(futureTwoHours, fixedNow)).toBe('Due in 2 hours');
    });

    it('handles same-day future deadlines (minutes)', () => {
      // 45 minutes in future
      const future45Mins = new Date(fixedNow.getTime() + 45 * 60 * 1000).toISOString();
      expect(describeDeadline(future45Mins, fixedNow)).toBe('Due in 45 minutes');
    });

    it('handles tomorrow deadlines', () => {
      // Exactly next day at same time
      const tomorrow = new Date(fixedNow.getTime() + 24 * 60 * 60 * 1000).toISOString();
      const result = describeDeadline(tomorrow, fixedNow);
      expect(result).toMatch(/^Due tomorrow at /);
    });

    it('handles past deadlines (hours)', () => {
      // 3 hours ago
      const pastThreeHours = new Date(fixedNow.getTime() - 3 * 60 * 60 * 1000).toISOString();
      expect(describeDeadline(pastThreeHours, fixedNow)).toBe('Deadline passed 3 hours ago');
    });

    it('handles past deadlines (minutes)', () => {
      // 15 minutes ago
      const past15Mins = new Date(fixedNow.getTime() - 15 * 60 * 1000).toISOString();
      expect(describeDeadline(past15Mins, fixedNow)).toBe('Deadline passed 15 minutes ago');
    });

    it('handles past deadlines (days)', () => {
      // 2 days ago
      const pastTwoDays = new Date(fixedNow.getTime() - 48 * 60 * 60 * 1000).toISOString();
      expect(describeDeadline(pastTwoDays, fixedNow)).toBe('Deadline passed 2 days ago');
    });
  });

  describe('formatDateTime', () => {
    it('returns a formatted localized string for valid ISO', () => {
      const formatted = formatDateTime('2026-10-15T14:30:00Z');
      expect(formatted).toBeTruthy();
      expect(typeof formatted).toBe('string');
      expect(formatted).toMatch(/2026/);
    });

    it('returns empty string for invalid dates', () => {
      expect(formatDateTime('invalid-date')).toBe('');
    });
  });
});
