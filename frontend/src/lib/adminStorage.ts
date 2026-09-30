import type { AdminGroupStorageData } from '../api/types';

const ADMIN_PREFIX = 'pollapp.admin.';
const adminMemoryStore = new Map<string, string>();

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
  return adminMemoryStore.get(key) ?? null;
}

function setRaw(key: string, value: string): void {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.setItem(key, value);
      adminMemoryStore.delete(key);
      return;
    }
  } catch {
    // localStorage threw or access denied
  }
  adminMemoryStore.set(key, value);
}

function removeRaw(key: string): void {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.removeItem(key);
    }
  } catch {
    // ignore
  }
  adminMemoryStore.delete(key);
}

function parseAdminData(raw: string | null): AdminGroupStorageData | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (
      parsed &&
      typeof parsed === 'object' &&
      'adminToken' in parsed &&
      'groupName' in parsed &&
      typeof (parsed as AdminGroupStorageData).adminToken === 'string' &&
      typeof (parsed as AdminGroupStorageData).groupName === 'string'
    ) {
      return {
        adminToken: (parsed as AdminGroupStorageData).adminToken,
        groupName: (parsed as AdminGroupStorageData).groupName,
      };
    }
    return null;
  } catch {
    return null;
  }
}

export function getAdmin(groupId: string): AdminGroupStorageData | null {
  if (!groupId) return null;
  const key = `${ADMIN_PREFIX}${groupId}`;
  const raw = getRaw(key);
  return parseAdminData(raw);
}

export function saveAdmin(groupId: string, data: AdminGroupStorageData): void {
  if (!groupId) return;
  const key = `${ADMIN_PREFIX}${groupId}`;
  const serialized = JSON.stringify(data);
  setRaw(key, serialized);
}

export function clearAdmin(groupId: string): void {
  if (!groupId) return;
  const key = `${ADMIN_PREFIX}${groupId}`;
  removeRaw(key);
}

export function listAdminGroups(): Array<{
  groupId: string;
  groupName: string;
  adminToken: string;
}> {
  const groupsMap = new Map<string, { groupId: string; groupName: string; adminToken: string }>();

  // 1. Scan localStorage
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      const total = window.localStorage.length;
      for (let i = 0; i < total; i++) {
        const key = window.localStorage.key(i);
        if (key && key.startsWith(ADMIN_PREFIX)) {
          const groupId = key.slice(ADMIN_PREFIX.length);
          const raw = window.localStorage.getItem(key);
          const data = parseAdminData(raw);
          if (data && groupId) {
            groupsMap.set(groupId, {
              groupId,
              groupName: data.groupName,
              adminToken: data.adminToken,
            });
          }
        }
      }
    }
  } catch {
    // ignore
  }

  // 2. Scan in-memory fallback
  for (const [key, raw] of adminMemoryStore.entries()) {
    if (key.startsWith(ADMIN_PREFIX)) {
      const groupId = key.slice(ADMIN_PREFIX.length);
      const data = parseAdminData(raw);
      if (data && groupId && !groupsMap.has(groupId)) {
        groupsMap.set(groupId, {
          groupId,
          groupName: data.groupName,
          adminToken: data.adminToken,
        });
      }
    }
  }

  return Array.from(groupsMap.values());
}

/** Helper for test cleanup */
export function _clearAdminMemoryStore(): void {
  adminMemoryStore.clear();
}
