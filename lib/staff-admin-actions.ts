'use server';

import { revalidatePath } from 'next/cache';
import { supabaseAdmin } from '@lala/shared/lib/supabase/server';
import { getAccess, type Role } from '@lala/shared/lib/roles';
import type { JobTitle } from './staff-constants';

export interface StaffRow {
  authUserId: string;
  name: string | null;
  role: Role;
  jobTitle: JobTitle | null;
  email: string | null;
  joinedAt: string;
}

/** 이메일로 기존 auth 사용자를 찾는다 (회원가입은 앱에서 먼저 해야 함 — 여기선 계정을 새로 만들지 않는다). */
async function findAuthUserByEmail(email: string): Promise<{ id: string } | null> {
  const sb = supabaseAdmin();
  const target = email.trim().toLowerCase();
  const perPage = 200;
  for (let page = 1; page <= 20; page++) {
    const { data, error } = await sb.auth.admin.listUsers({ page, perPage });
    if (error || !data) return null;
    const found = data.users.find((u) => (u.email ?? '').toLowerCase() === target);
    if (found) return { id: found.id };
    if (data.users.length < perPage) break;
  }
  return null;
}

/** 직원 목록 (isApprover 전용) */
export async function listStaff(): Promise<StaffRow[]> {
  const me = await getAccess();
  if (!me?.isApprover) return [];

  const sb = supabaseAdmin();
  const { data, error } = await sb
    .from('staff')
    .select('auth_user_id,name,role,job_title,created_at')
    .order('created_at', { ascending: true });
  if (error || !data) return [];

  const rows = data as unknown as { auth_user_id: string; name: string | null; role: Role; job_title: JobTitle | null; created_at: string }[];

  // 이메일은 auth.users에 있어서 관리자 API로 하나씩 조회 (직원 수가 많지 않은 팀 기준)
  return Promise.all(
    rows.map(async (r) => {
      const { data: userData } = await sb.auth.admin.getUserById(r.auth_user_id);
      return {
        authUserId: r.auth_user_id, name: r.name, role: r.role, jobTitle: r.job_title,
        email: userData?.user?.email ?? null, joinedAt: r.created_at,
      };
    }),
  );
}

/** role='director'인 인원 수. 마지막 1명은 role 변경/제거를 막는다(관리 가능자가 0명이 되는 걸 방지). */
async function directorCount(sb: ReturnType<typeof supabaseAdmin>): Promise<number> {
  const { count } = await sb.from('staff').select('auth_user_id', { count: 'exact', head: true }).eq('role', 'director');
  return count ?? 0;
}

/** 이미 가입된 계정을 이메일로 찾아 직원으로 등록 (계정을 새로 만들지 않음, isApprover 전용) */
export async function addStaffByEmail(
  email: string,
  name: string,
  role: Role,
  jobTitle: JobTitle,
): Promise<{ ok: boolean; reason?: string }> {
  const me = await getAccess();
  if (!me?.isApprover) return { ok: false, reason: '권한이 없습니다.' };
  if (!email.trim()) return { ok: false, reason: '이메일을 입력해주세요.' };

  const user = await findAuthUserByEmail(email);
  if (!user) return { ok: false, reason: '해당 이메일로 가입된 계정을 찾을 수 없습니다. 먼저 앱에서 회원가입 후 다시 시도해주세요.' };

  const sb = supabaseAdmin();
  const { data: existing } = await sb.from('staff').select('auth_user_id').eq('auth_user_id', user.id).maybeSingle();
  if (existing) return { ok: false, reason: '이미 직원으로 등록되어 있습니다.' };

  const { error } = await sb.from('staff').insert({ auth_user_id: user.id, role, job_title: jobTitle, name: name.trim() || null });
  if (error) return { ok: false, reason: '등록 중 오류가 발생했습니다.' };

  revalidatePath('/admin/staff');
  return { ok: true };
}

/** 직원 권한(role) 변경. 마지막 director를 다른 role로 바꾸는 건 막는다. */
export async function updateStaffRole(authUserId: string, role: Role): Promise<{ ok: boolean; reason?: string }> {
  const me = await getAccess();
  if (!me?.isApprover) return { ok: false, reason: '권한이 없습니다.' };

  const sb = supabaseAdmin();
  const { data: target } = await sb.from('staff').select('role').eq('auth_user_id', authUserId).maybeSingle();
  if (!target) return { ok: false, reason: '직원을 찾을 수 없습니다.' };

  if ((target as { role: Role }).role === 'director' && role !== 'director') {
    const count = await directorCount(sb);
    if (count <= 1) return { ok: false, reason: '마지막 director라 권한을 변경할 수 없습니다. 다른 director를 먼저 등록해주세요.' };
  }

  const { error } = await sb.from('staff').update({ role }).eq('auth_user_id', authUserId);
  if (error) return { ok: false, reason: '변경 중 오류가 발생했습니다.' };

  revalidatePath('/admin/staff');
  return { ok: true };
}

/** 직원 직함(job_title) 변경 — 표시용, 권한과 무관 */
export async function updateStaffJobTitle(authUserId: string, jobTitle: JobTitle): Promise<{ ok: boolean; reason?: string }> {
  const me = await getAccess();
  if (!me?.isApprover) return { ok: false, reason: '권한이 없습니다.' };

  const sb = supabaseAdmin();
  const { error } = await sb.from('staff').update({ job_title: jobTitle }).eq('auth_user_id', authUserId);
  if (error) return { ok: false, reason: '변경 중 오류가 발생했습니다.' };

  revalidatePath('/admin/staff');
  return { ok: true };
}

/** 직원 등록 해제. auth 계정 자체는 지우지 않고 staff에서만 제거 — 언제든 재등록 가능. 마지막 director는 제거할 수 없다. */
export async function removeStaff(authUserId: string): Promise<{ ok: boolean; reason?: string }> {
  const me = await getAccess();
  if (!me?.isApprover) return { ok: false, reason: '권한이 없습니다.' };

  const sb = supabaseAdmin();
  const { data: target } = await sb.from('staff').select('role').eq('auth_user_id', authUserId).maybeSingle();
  if (!target) return { ok: false, reason: '직원을 찾을 수 없습니다.' };

  if ((target as { role: Role }).role === 'director') {
    const count = await directorCount(sb);
    if (count <= 1) return { ok: false, reason: '마지막 director라 제거할 수 없습니다. 다른 director를 먼저 등록해주세요.' };
  }

  const { error } = await sb.from('staff').delete().eq('auth_user_id', authUserId);
  if (error) return { ok: false, reason: '제거 중 오류가 발생했습니다.' };

  revalidatePath('/admin/staff');
  return { ok: true };
}
