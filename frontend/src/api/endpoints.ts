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
