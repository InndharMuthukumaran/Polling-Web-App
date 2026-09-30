import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  _clearAdminMemoryStore,
  clearAdmin,
  getAdmin,
  listAdminGroups,
  saveAdmin,
} from './adminStorage';

describe('adminStorage.ts', () => {
  beforeEach(() => {
    localStorage.clear();
    _clearAdminMemoryStore();
    vi.restoreAllMocks();
  });

  const sampleData = {
    adminToken: 'admin-secret-token',
    groupName: 'Weekend Football',
  };

  it('saves and reads back admin data for a group', () => {
    saveAdmin('grp-123', sampleData);
    const read = getAdmin('grp-123');
    expect(read).toEqual(sampleData);
  });

  it('lists saved admin groups from storage', () => {
    saveAdmin('grp-1', { adminToken: 'tok-1', groupName: 'Group 1' });
    saveAdmin('grp-2', { adminToken: 'tok-2', groupName: 'Group 2' });

    const list = listAdminGroups();
    expect(list).toHaveLength(2);
    expect(list).toEqual(
      expect.arrayContaining([
        { groupId: 'grp-1', adminToken: 'tok-1', groupName: 'Group 1' },
        { groupId: 'grp-2', adminToken: 'tok-2', groupName: 'Group 2' },
      ]),
    );
  });

  it('clears admin data for a group', () => {
    saveAdmin('grp-del', sampleData);
    expect(getAdmin('grp-del')).toEqual(sampleData);

    clearAdmin('grp-del');
    expect(getAdmin('grp-del')).toBeNull();
  });

  it('treats corrupt JSON data as empty', () => {
    localStorage.setItem('pollapp.admin.corrupt1', '{invalid-json:');
    expect(getAdmin('corrupt1')).toBeNull();

    localStorage.setItem('pollapp.admin.corrupt2', JSON.stringify({ wrongField: 'val' }));
    expect(getAdmin('corrupt2')).toBeNull();

    // Listing ignores corrupt entries
    const list = listAdminGroups();
    expect(list).toEqual([]);
  });

  it('operates via in-memory fallback when localStorage throws', () => {
    vi.spyOn(window.localStorage, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });
    vi.spyOn(window.localStorage, 'getItem').mockImplementation(() => {
      throw new Error('AccessDeniedError');
    });

    saveAdmin('grp-fallback', sampleData);
    const retrieved = getAdmin('grp-fallback');
    expect(retrieved).toEqual(sampleData);

    const list = listAdminGroups();
    expect(list).toContainEqual({
      groupId: 'grp-fallback',
      adminToken: 'admin-secret-token',
      groupName: 'Weekend Football',
    });
  });
});
