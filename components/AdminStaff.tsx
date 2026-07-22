'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  addStaffByEmail, updateStaffRole, updateStaffJobTitle, removeStaff, type StaffRow,
} from '@/lib/staff-admin-actions';
import { ALL_JOB_TITLES, ALL_ROLES, type JobTitle } from '@/lib/staff-constants';
import type { Role } from '@lala/shared/lib/roles';

const dateOnly = (s: string) => s.slice(0, 10);

export default function AdminStaff({ staff, currentUserId }: { staff: StaffRow[]; currentUserId: string | null }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [busyId, setBusyId] = useState<string | null>(null);

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [role, setRole] = useState<Role>('delivery');
  const [jobTitle, setJobTitle] = useState<JobTitle>('배송직원');
  const [formError, setFormError] = useState<string | null>(null);

  function openAdd() {
    setEmail(''); setName(''); setRole('delivery'); setJobTitle('배송직원'); setFormError(null);
    setDrawerOpen(true);
  }

  function submitAdd() {
    setFormError(null);
    startTransition(async () => {
      const result = await addStaffByEmail(email, name, role, jobTitle);
      if (!result.ok) { setFormError(result.reason ?? '등록에 실패했습니다.'); return; }
      setDrawerOpen(false);
      router.refresh();
    });
  }

  function changeRole(authUserId: string, to: Role) {
    setBusyId(authUserId);
    startTransition(async () => {
      const result = await updateStaffRole(authUserId, to);
      setBusyId(null);
      if (!result.ok) alert(result.reason ?? '변경에 실패했습니다.');
      router.refresh();
    });
  }

  function changeJobTitle(authUserId: string, to: JobTitle) {
    setBusyId(authUserId);
    startTransition(async () => {
      const result = await updateStaffJobTitle(authUserId, to);
      setBusyId(null);
      if (!result.ok) alert(result.reason ?? '변경에 실패했습니다.');
      router.refresh();
    });
  }

  function remove(authUserId: string, label: string) {
    if (!confirm(`${label} 님을 직원에서 제거할까요? (계정 자체는 삭제되지 않고, 다시 등록할 수 있어요)`)) return;
    setBusyId(authUserId);
    startTransition(async () => {
      const result = await removeStaff(authUserId);
      setBusyId(null);
      if (!result.ok) alert(result.reason ?? '제거에 실패했습니다.');
      router.refresh();
    });
  }

  return (
    <section>
      <div className="admin-topbar">
        <h1 className="staff-title">직원</h1>
        <button className="btn-primary" onClick={openAdd}>+ 직원 등록</button>
      </div>
      <p className="prod-brand" style={{ marginBottom: 16 }}>
        먼저 앱에서 회원가입(이메일)을 마친 계정만 등록할 수 있어요 — 여기서 새 계정을 만들지는 않아요.
        직함은 표시용이고, 실제 화면 접근 권한은 "권한" 열의 값으로 결정돼요.
      </p>

      {staff.length === 0 ? (
        <p className="staff-empty">등록된 직원이 없습니다.</p>
      ) : (
        <div className="dtable-wrap">
          <table className="dtable">
            <thead><tr><th>이름</th><th>권한</th><th>직함</th><th>이메일</th><th>등록일</th><th></th></tr></thead>
            <tbody>
              {staff.map((s) => {
                const isSelf = s.authUserId === currentUserId;
                const rowBusy = pending && busyId === s.authUserId;
                return (
                  <tr key={s.authUserId}>
                    <td className="prod-name">{s.name ?? '(이름 없음)'} {isSelf && <span className="prod-brand">· 나</span>}</td>
                    <td>
                      <select className="admin-select-filter" value={s.role} disabled={pending}
                        onChange={(e) => changeRole(s.authUserId, e.target.value as Role)}>
                        {ALL_ROLES.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
                      </select>
                    </td>
                    <td>
                      <select className="admin-select-filter" value={s.jobTitle ?? ''} disabled={pending}
                        onChange={(e) => changeJobTitle(s.authUserId, e.target.value as JobTitle)}>
                        {ALL_JOB_TITLES.map((jt) => <option key={jt} value={jt}>{jt}</option>)}
                      </select>
                    </td>
                    <td>{s.email ?? '—'}</td>
                    <td>{dateOnly(s.joinedAt)}</td>
                    <td>
                      <button className="btn-text" disabled={pending} onClick={() => remove(s.authUserId, s.name ?? s.email ?? '이 직원')}>
                        {rowBusy ? '처리 중…' : '제거'}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {drawerOpen && (
        <>
          <div className="drawer-overlay" onClick={() => !pending && setDrawerOpen(false)} />
          <div className="drawer">
            <h2>직원 등록</h2>
            <div className="field-group">
              <label>이메일 (기존 가입 계정)</label>
              <input className="field" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="staff@example.com" />
            </div>
            <div className="field-group">
              <label>이름</label>
              <input className="field" value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="field-group">
              <label>권한</label>
              <select className="field" value={role} onChange={(e) => setRole(e.target.value as Role)}>
                {ALL_ROLES.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
              </select>
            </div>
            <div className="field-group">
              <label>직함 (표시용)</label>
              <select className="field" value={jobTitle} onChange={(e) => setJobTitle(e.target.value as JobTitle)}>
                {ALL_JOB_TITLES.map((jt) => <option key={jt} value={jt}>{jt}</option>)}
              </select>
            </div>

            {formError && <p style={{ color: 'var(--wine)', fontSize: 12 }}>{formError}</p>}

            <div className="drawer-actions">
              <button className="btn-ghost" onClick={() => setDrawerOpen(false)} disabled={pending}>취소</button>
              <button className="btn-primary" onClick={submitAdd} disabled={pending}>{pending ? '등록 중…' : '등록'}</button>
            </div>
          </div>
        </>
      )}
    </section>
  );
}
