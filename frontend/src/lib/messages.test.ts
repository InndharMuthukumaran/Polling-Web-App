import { describe, expect, it } from 'vitest';
import {
  buildAnnouncement,
  buildReminder,
  namesForCopy,
} from './messages';

describe('messages.ts', () => {
  const samplePoll = {
    name: 'Weekly Sprint Review',
    description_raw: 'Please submit your demo links.',
    deadline: '2026-10-20T17:00:00Z',
  };
  const link = 'http://localhost:5173/p/poll-123';

  describe('buildAnnouncement', () => {
    it('contains poll name, description, formatted deadline, and voting link', () => {
      const msg = buildAnnouncement(samplePoll, link);
      expect(msg).toContain('Weekly Sprint Review');
      expect(msg).toContain('Please submit your demo links.');
      expect(msg).toContain('Deadline:');
      expect(msg).toContain(link);
    });

    it('handles missing description and missing deadline gracefully', () => {
      const msg = buildAnnouncement(
        {
          name: 'Quick Vote',
          description_raw: null,
          deadline: null,
        },
        link,
      );
      expect(msg).toContain('Quick Vote');
      expect(msg).toContain(link);
      expect(msg).not.toContain('Deadline:');
    });
  });

  describe('buildReminder', () => {
    it('contains reminder prompt, poll name, deadline, and link', () => {
      const msg = buildReminder(samplePoll, link);
      expect(msg).toContain('Weekly Sprint Review');
      expect(msg).toContain('Deadline:');
      expect(msg).toContain(link);
    });

    it('handles missing description and missing deadline gracefully', () => {
      const msg = buildReminder(
        {
          name: 'Urgent Decision',
          description_raw: undefined,
          deadline: undefined,
        },
        link,
      );
      expect(msg).toContain('Urgent Decision');
      expect(msg).toContain(link);
      expect(msg).not.toContain('Deadline:');
    });
  });

  describe('namesForCopy', () => {
    it('formats member names joined by newlines', () => {
      const members = [
        { display_name: 'Alice' },
        { display_name: 'Bob' },
        { display_name: 'Charlie' },
      ];
      expect(namesForCopy(members)).toBe('Alice\nBob\nCharlie');
    });

    it('formats member names with identifiers as Name (identifier) and distinguishes duplicate names', () => {
      const members = [
        { display_name: 'Asha K', identifier: '21001' },
        { display_name: 'Asha K', identifier: '21002' },
        { display_name: 'Bob', identifier: null },
      ];
      expect(namesForCopy(members)).toBe('Asha K (21001)\nAsha K (21002)\nBob');
    });

    it('handles empty list', () => {
      expect(namesForCopy([])).toBe('');
    });
  });
});
