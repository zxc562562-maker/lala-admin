'use client';

import { Suspense, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { supabaseBrowser } from '@lala/shared/lib/supabase/client';
import { idToAuthEmail } from '@lala/shared/lib/username';

function LoginForm() {
  const params = useSearchParams();
  const next = params.get('next') || '/admin';
  const [id, setId] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit() {
    setErr(null);
    if (!id || !password) { setErr('ID와 비밀번호를 입력해주세요.'); return; }
    setBusy(true);

    const sb = supabaseBrowser();
    const { error } = await sb.auth.signInWithPassword({ email: idToAuthEmail(id), password });
    if (error) { setBusy(false); setErr('ID 또는 비밀번호가 올바르지 않습니다.'); return; }

    window.location.href = next;
  }

  return (
    <div className="auth">
      <div className="auth-form">
        <input className="field" placeholder="ID" value={id} onChange={(e) => setId(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && submit()} />
        <input className="field" type="password" placeholder="비밀번호" value={password} onChange={(e) => setPassword(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && submit()} />
        {err && <div className="hint err">{err}</div>}
        <button className="cta" style={{ padding: '9px 12px', fontSize: 13 }} disabled={busy} onClick={submit}>
          {busy ? '확인 중…' : '로그인'}
        </button>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <div className="landing-wrap">
      <div className="landing" style={{ gap: 28 }}>
        <div className="landing-lock">
          <span className="wordmark landing-word" style={{ fontSize: 152 }}>Lala</span>
          <span className="gold-rule landing-rule" />
        </div>
        <Suspense fallback={null}>
          <LoginForm />
        </Suspense>
      </div>
    </div>
  );
}
