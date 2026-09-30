import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  _clearMemoryStore,
  clearMemberIdentity,
  getMemberIdentity,
  saveMemberIdentity,
} from './storage';
import type { StoredMemberIdentity } from '../api/types';

describe('storage.ts', () => {
  beforeEach(() => {
    localStorage.clear();
    _clearMemoryStore();
    vi.restoreAllMocks();
  });

  const sampleIdentity: StoredMemberIdentity = {
    memberToken: 'tok-12345',
    memberId: 'mem-uuid-1',
    displayName: 'Alice Cooper',
  };

  it('saves and reads back a member identity', () => {
    saveMemberIdentity('joinABC', sampleIdentity);
    const read = getMemberIdentity('joinABC');
    expect(read).toEqual(sampleIdentity);
  });

  it('treats corrupt JSON in localStorage as empty (null)', () => {
    localStorage.setItem('pollapp.member.joinCorrupt', '{invalid-json:');
    expect(getMemberIdentity('joinCorrupt')).toBeNull();

    localStorage.setItem('pollapp.member.joinIncomplete', JSON.stringify({ wrongField: 'val' }));
    expect(getMemberIdentity('joinIncomplete')).toBeNull();
  });

  it('works through in-memory fallback when localStorage throws', () => {
    vi.spyOn(window.localStorage, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });
    vi.spyOn(window.localStorage, 'getItem').mockImplementation(() => {
      throw new Error('AccessDeniedError');
    });

    saveMemberIdentity('joinFallback', sampleIdentity);
    const retrieved = getMemberIdentity('joinFallback');
    expect(retrieved).toEqual(sampleIdentity);
  });

  it('clears stored identity properly', () => {
    saveMemberIdentity('joinClear', sampleIdentity);
    expect(getMemberIdentity('joinClear')).toEqual(sampleIdentity);

    clearMemberIdentity('joinClear');
    expect(getMemberIdentity('joinClear')).toBeNull();
  });
});
