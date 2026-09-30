import { request } from './client';
import type {
  ClaimResponse,
  JoinGroupResponse,
  MeResponse,
  MemberPollMeResponse,
  MemberPollSummary,
  PublicPollResponse,
  VoteResponse,
} from './types';

export async function getJoinInfo(joinCode: string): Promise<JoinGroupResponse> {
  return request<JoinGroupResponse>(`/api/v1/join/${encodeURIComponent(joinCode)}`, {
    method: 'GET',
  });
}

export async function claimMember(
  joinCode: string,
  memberId: string,
): Promise<ClaimResponse> {
  return request<ClaimResponse>(`/api/v1/join/${encodeURIComponent(joinCode)}/claim`, {
    method: 'POST',
    body: { member_id: memberId },
  });
}

export async function getMe(memberToken: string): Promise<MeResponse> {
  return request<MeResponse>('/api/v1/me', {
    method: 'GET',
    token: memberToken,
  });
}

export async function getMyPolls(memberToken: string): Promise<MemberPollSummary[]> {
  return request<MemberPollSummary[]>('/api/v1/me/polls', {
    method: 'GET',
    token: memberToken,
  });
}

export async function getPublicPoll(pollId: string): Promise<PublicPollResponse> {
  return request<PublicPollResponse>(`/api/v1/polls/${encodeURIComponent(pollId)}`, {
    method: 'GET',
  });
}

export async function castVote(
  pollId: string,
  optionId: string,
  memberToken: string,
): Promise<VoteResponse> {
  return request<VoteResponse>(`/api/v1/polls/${encodeURIComponent(pollId)}/vote`, {
    method: 'POST',
    token: memberToken,
    body: { option_id: optionId },
  });
}

export async function deleteVote(
  pollId: string,
  memberToken: string,
  optionId?: string,
): Promise<VoteResponse> {
  const query = optionId ? `?option_id=${encodeURIComponent(optionId)}` : '';
  return request<VoteResponse>(`/api/v1/polls/${encodeURIComponent(pollId)}/vote${query}`, {
    method: 'DELETE',
    token: memberToken,
  });
}

export async function getMyPollHistory(
  pollId: string,
  memberToken: string,
): Promise<MemberPollMeResponse> {
  return request<MemberPollMeResponse>(`/api/v1/polls/${encodeURIComponent(pollId)}/me`, {
    method: 'GET',
    token: memberToken,
  });
}

// Creator / Admin Endpoints (Part 3B)

export async function createGroup(name: string): Promise<import('./types').CreateGroupResponse> {
  return request<import('./types').CreateGroupResponse>('/api/v1/groups', {
    method: 'POST',
    body: { name },
  });
}

export async function getGroup(
  groupId: string,
  adminToken: string,
): Promise<import('./types').AdminGroupDetailResponse> {
  return request<import('./types').AdminGroupDetailResponse>(
    `/api/v1/groups/${encodeURIComponent(groupId)}`,
    {
      method: 'GET',
      adminToken,
    },
  );
}

export async function updateGroup(
  groupId: string,
  adminToken: string,
  payload: { require_claim_approval?: boolean },
): Promise<import('./types').AdminGroupDetailResponse> {
  return request<import('./types').AdminGroupDetailResponse>(
    `/api/v1/groups/${encodeURIComponent(groupId)}`,
    {
      method: 'PATCH',
      adminToken,
      body: payload,
    },
  );
}

export async function addMembers(
  groupId: string,
  adminToken: string,
  displayNames: string[],
): Promise<import('./types').GroupMember[]> {
  return request<import('./types').GroupMember[]>(
    `/api/v1/groups/${encodeURIComponent(groupId)}/members`,
    {
      method: 'POST',
      adminToken,
      body: { display_names: displayNames },
    },
  );
}

export async function updateMember(
  groupId: string,
  memberId: string,
  adminToken: string,
  payload: { display_name?: string; is_active?: boolean },
): Promise<import('./types').GroupMember> {
  return request<import('./types').GroupMember>(
    `/api/v1/groups/${encodeURIComponent(groupId)}/members/${encodeURIComponent(memberId)}`,
    {
      method: 'PATCH',
      adminToken,
      body: payload,
    },
  );
}

export async function approveMemberClaim(
  groupId: string,
  memberId: string,
  adminToken: string,
): Promise<{ status: string }> {
  return request<{ status: string }>(
    `/api/v1/groups/${encodeURIComponent(groupId)}/members/${encodeURIComponent(memberId)}/approve`,
    {
      method: 'POST',
      adminToken,
    },
  );
}

export async function resetMemberClaim(
  groupId: string,
  memberId: string,
  adminToken: string,
): Promise<{ status: string }> {
  return request<{ status: string }>(
    `/api/v1/groups/${encodeURIComponent(groupId)}/members/${encodeURIComponent(memberId)}/reset`,
    {
      method: 'POST',
      adminToken,
    },
  );
}

export async function createPoll(
  groupId: string,
  adminToken: string,
  payload: import('./types').CreatePollPayload,
): Promise<import('./types').CreatePollResponse> {
  return request<import('./types').CreatePollResponse>(
    `/api/v1/groups/${encodeURIComponent(groupId)}/polls`,
    {
      method: 'POST',
      adminToken,
      body: payload,
    },
  );
}

export async function getGroupPolls(
  groupId: string,
  adminToken: string,
): Promise<import('./types').AdminPollListItem[]> {
  return request<import('./types').AdminPollListItem[]>(
    `/api/v1/groups/${encodeURIComponent(groupId)}/polls`,
    {
      method: 'GET',
      adminToken,
    },
  );
}

export async function getAdminPollStatus(
  pollId: string,
  adminToken: string,
): Promise<import('./types').AdminPollStatusResponse> {
  return request<import('./types').AdminPollStatusResponse>(
    `/api/v1/polls/${encodeURIComponent(pollId)}/status`,
    {
      method: 'GET',
      adminToken,
    },
  );
}

export async function getAdminPollHistory(
  pollId: string,
  adminToken: string,
): Promise<import('./types').AdminPollHistoryResponse> {
  return request<import('./types').AdminPollHistoryResponse>(
    `/api/v1/polls/${encodeURIComponent(pollId)}/history`,
    {
      method: 'GET',
      adminToken,
    },
  );
}

export async function closePoll(
  pollId: string,
  adminToken: string,
): Promise<{ status: string }> {
  return request<{ status: string }>(
    `/api/v1/polls/${encodeURIComponent(pollId)}/close`,
    {
      method: 'POST',
      adminToken,
    },
  );
}

