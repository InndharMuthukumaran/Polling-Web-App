import { request } from './client';
import type {
  AdminGroupDetailResponse,
  ClaimResponse,
  CreateFieldPayload,
  CreateGroupResponse,
  GroupField,
  GroupMember,
  ImportMembersOptions,
  ImportPreviewResponse,
  ImportResultResponse,
  JoinGroupResponse,
  MeResponse,
  MemberInput,
  MemberPollMeResponse,
  MemberPollSummary,
  PublicPollResponse,
  ReleaseClaimResponse,
  UpdateFieldPayload,
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

export async function releaseClaim(memberToken: string): Promise<ReleaseClaimResponse> {
  return request<ReleaseClaimResponse>('/api/v1/me/release', {
    method: 'POST',
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

// Creator / Admin Endpoints (Part 3B & R4)

export async function createGroup(name: string): Promise<CreateGroupResponse> {
  return request<CreateGroupResponse>('/api/v1/groups', {
    method: 'POST',
    body: { name },
  });
}

export async function getGroup(
  groupId: string,
  adminToken: string,
): Promise<AdminGroupDetailResponse> {
  return request<AdminGroupDetailResponse>(
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
  payload: { require_claim_approval?: boolean; allow_name_list?: boolean },
): Promise<AdminGroupDetailResponse> {
  return request<AdminGroupDetailResponse>(
    `/api/v1/groups/${encodeURIComponent(groupId)}`,
    {
      method: 'PATCH',
      adminToken,
      body: payload,
    },
  );
}

export async function createField(
  groupId: string,
  adminToken: string,
  payload: CreateFieldPayload,
): Promise<GroupField> {
  return request<GroupField>(`/api/v1/groups/${encodeURIComponent(groupId)}/fields`, {
    method: 'POST',
    adminToken,
    body: payload,
  });
}

export async function updateField(
  groupId: string,
  fieldId: string,
  adminToken: string,
  payload: UpdateFieldPayload,
): Promise<GroupField> {
  return request<GroupField>(
    `/api/v1/groups/${encodeURIComponent(groupId)}/fields/${encodeURIComponent(fieldId)}`,
    {
      method: 'PATCH',
      adminToken,
      body: payload,
    },
  );
}

export async function deleteField(
  groupId: string,
  fieldId: string,
  adminToken: string,
): Promise<void> {
  return request<void>(
    `/api/v1/groups/${encodeURIComponent(groupId)}/fields/${encodeURIComponent(fieldId)}`,
    {
      method: 'DELETE',
      adminToken,
    },
  );
}

export async function addMembers(
  groupId: string,
  adminToken: string,
  members: string[] | MemberInput[],
): Promise<GroupMember[]> {
  const isStringArray = members.length > 0 && typeof members[0] === 'string';
  const body = isStringArray ? { display_names: members } : { members };

  return request<GroupMember[]>(
    `/api/v1/groups/${encodeURIComponent(groupId)}/members`,
    {
      method: 'POST',
      adminToken,
      body,
    },
  );
}

export async function updateMember(
  groupId: string,
  memberId: string,
  adminToken: string,
  payload: {
    display_name?: string;
    is_active?: boolean;
    values?: Record<string, string | number | null>;
  },
): Promise<GroupMember> {
  return request<GroupMember>(
    `/api/v1/groups/${encodeURIComponent(groupId)}/members/${encodeURIComponent(memberId)}`,
    {
      method: 'PATCH',
      adminToken,
      body: payload,
    },
  );
}

export async function downloadMemberTemplate(
  groupId: string,
  adminToken: string,
  format: 'xlsx' | 'csv',
): Promise<Blob & { filename: string; blob: Blob }> {
  return request<Blob & { filename: string; blob: Blob }>(
    `/api/v1/groups/${encodeURIComponent(groupId)}/members/template?format=${encodeURIComponent(format)}`,
    {
      method: 'GET',
      adminToken,
      responseType: 'blob',
    },
  );
}

export async function previewMemberImport(
  groupId: string,
  adminToken: string,
  file: File,
): Promise<ImportPreviewResponse> {
  const formData = new FormData();
  formData.append('file', file);
  return request<ImportPreviewResponse>(
    `/api/v1/groups/${encodeURIComponent(groupId)}/members/import/preview`,
    {
      method: 'POST',
      adminToken,
      body: formData,
    },
  );
}

export async function importMembers(
  groupId: string,
  adminToken: string,
  options: ImportMembersOptions,
): Promise<ImportResultResponse> {
  const formData = new FormData();
  formData.append('file', options.file);
  formData.append('mapping', JSON.stringify(options.mapping));
  if (options.new_fields && options.new_fields.length > 0) {
    formData.append('new_fields', JSON.stringify(options.new_fields));
  }
  formData.append('dry_run', options.dry_run ? 'true' : 'false');
  formData.append('on_duplicate', options.on_duplicate);

  return request<ImportResultResponse>(
    `/api/v1/groups/${encodeURIComponent(groupId)}/members/import`,
    {
      method: 'POST',
      adminToken,
      body: formData,
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

