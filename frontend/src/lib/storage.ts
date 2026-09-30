import type { StoredMemberIdentity } from '../api/types';

const memoryStore = new Map<string, string>();

function getRaw(key: string): string | null {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      const val = window.localStorage.getItem(key);
      if (val !== null) {
        return val;
      }
    }
  } catch {
    // localStorage unavailable or threw
  }
  return memoryStore.get(key) ?? null;
}

function setRaw(key: string, value: string): void {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.setItem(key, value);
      memoryStore.delete(key);
      return;
    }
  } catch {
    // localStorage access denied or threw; write to memory fallback
  }
  memoryStore.set(key, value);
}

function removeRaw(key: string): void {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.removeItem(key);
    }
  } catch {
    // ignore
  }
  memoryStore.delete(key);
}

export function getMemberIdentity(joinCode: string): StoredMemberIdentity | null {
  if (!joinCode) return null;
  const key = `pollapp.member.${joinCode}`;
  const raw = getRaw(key);
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (
      parsed &&
      typeof parsed === 'object' &&
      'memberToken' in parsed &&
      'memberId' in parsed &&
      'displayName' in parsed &&
      typeof (parsed as StoredMemberIdentity).memberToken === 'string' &&
      typeof (parsed as StoredMemberIdentity).memberId === 'string' &&
      typeof (parsed as StoredMemberIdentity).displayName === 'string'
    ) {
      return {
        memberToken: (parsed as StoredMemberIdentity).memberToken,
        memberId: (parsed as StoredMemberIdentity).memberId,
        displayName: (parsed as StoredMemberIdentity).displayName,
      };
    }
    // Corrupt or unexpected JSON structure treated as empty
    return null;
  } catch {
    // Corrupt JSON treated as empty
    return null;
  }
}

export function saveMemberIdentity(joinCode: string, identity: StoredMemberIdentity): void {
  if (!joinCode) return;
  const key = `pollapp.member.${joinCode}`;
  const serialized = JSON.stringify(identity);
  setRaw(key, serialized);
}

export function clearMemberIdentity(joinCode: string): void {
  if (!joinCode) return;
  const key = `pollapp.member.${joinCode}`;
  removeRaw(key);
}

/** Helper for test cleanup */
export function _clearMemoryStore(): void {
  memoryStore.clear();
}
