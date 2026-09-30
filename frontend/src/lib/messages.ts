import { formatDateTime } from './time';

export interface PollMessageInfo {
  name: string;
  description_raw?: string | null;
  deadline?: string | null;
}

export function buildAnnouncement(poll: PollMessageInfo, link: string): string {
  const lines: string[] = [];
  lines.push(`📊 Poll: ${poll.name}`);

  if (poll.description_raw && poll.description_raw.trim()) {
    lines.push(poll.description_raw.trim());
  }

  if (poll.deadline) {
    const formatted = formatDateTime(poll.deadline);
    if (formatted) {
      lines.push(`⏰ Deadline: ${formatted}`);
    }
  }

  lines.push(`👉 Vote here: ${link}`);
  return lines.join('\n\n');
}

export function buildReminder(poll: PollMessageInfo, link: string): string {
  const lines: string[] = [];
  lines.push(`⏳ Reminder: Please vote on "${poll.name}"`);

  if (poll.deadline) {
    const formatted = formatDateTime(poll.deadline);
    if (formatted) {
      lines.push(`⏰ Deadline: ${formatted}`);
    }
  }

  if (poll.description_raw && poll.description_raw.trim()) {
    lines.push(poll.description_raw.trim());
  }

  lines.push(`👉 Link: ${link}`);
  return lines.join('\n\n');
}

export function namesForCopy(members: Array<{ display_name: string }>): string {
  return members
    .map((m) => m.display_name.trim())
    .filter(Boolean)
    .join('\n');
}

export async function copyToClipboard(text: string): Promise<boolean> {
  if (!text) return false;
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // fallback below
  }

  try {
    const textArea = document.createElement('textarea');
    textArea.value = text;
    textArea.style.position = 'fixed';
    textArea.style.left = '-9999px';
    textArea.style.top = '0';
    document.body.appendChild(textArea);
    textArea.focus();
    textArea.select();
    const successful = document.execCommand('copy');
    document.body.removeChild(textArea);
    return successful;
  } catch {
    return false;
  }
}
