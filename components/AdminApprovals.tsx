'use client';

import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { supabaseBrowser } from '@lala/shared/lib/supabase/client';
import { approveMember, rejectMember, type PendingMember } from '@lala/shared/lib/roles-actions';

export default function AdminApprovals({ pending }: { pending: PendingMember[] }) {
  const router = useRouter();
  const [busy, startTransition] = useTransition();
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    const sb = supabaseBrowser();
    const ch = sb.channel('approvals')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'customer' }, () => router.refresh())
      .subscribe();
    return () => { sb.removeChannel(ch); };
  }, [router]);

  function ok(id: string) { startTransition(async () => { await approveMember(id); router.refresh(); }); }
  function no(id: string) {
    setErr(null);
    startTransition(async () => {
      const res = await rejectMember(id);
      if (!res.ok && res.reason) setErr(res.reason);
      router.refresh();
    });
  }

  return (
    <section>
      <h1 className="staff-title">가입 승인 <span className="rt-dot" title="실시간">●</span></h1>
      {err && <p className="hint err">{err}</p>}
      {pending.length === 0 && <p className="staff-empty">대기 중인 가입 신청이 없어요.</p>}
      <div className="order-list">
        {pending.map((m) => (
          <div className="appr-row" key={m.id}>
            <div>
              <div className="appr-name">{m.name}</div>
              <div className="appr-email">{m.username ?? ''}{m.phone ? ` · ${m.phone}` : ''}</div>
            </div>
            <div className="appr-btns">
              <button className="appr-ok" disabled={busy} onClick={() => ok(m.id)}>승인</button>
              <button className="appr-no" disabled={busy} onClick={() => no(m.id)}>거절</button>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
