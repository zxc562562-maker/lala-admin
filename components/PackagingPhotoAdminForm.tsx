'use client';

import { useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { savePackagingPhoto } from '@lala/shared/lib/staff-actions';

export default function PackagingPhotoAdminForm({
  orderId, photoUrl,
}: {
  orderId: string;
  photoUrl: string | null;
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [busy, startTransition] = useTransition();
  const [err, setErr] = useState<string | null>(null);

  function pick(e: React.ChangeEvent<HTMLInputElement>) {
    setErr(null);
    const file = e.target.files?.[0];
    setPreview(file ? URL.createObjectURL(file) : null);
  }

  function upload() {
    const file = inputRef.current?.files?.[0];
    if (!file) { setErr('사진을 선택해주세요.'); return; }
    setErr(null);
    const formData = new FormData();
    formData.set('photo', file);
    startTransition(async () => {
      const res = await savePackagingPhoto(orderId, formData);
      if (res.ok) {
        setPreview(null);
        if (inputRef.current) inputRef.current.value = '';
        router.refresh();
      } else {
        setErr(res.reason);
      }
    });
  }

  return (
    <div className="order-issue-items">
      <div className="field-section" style={{ margin: '8px 0 4px' }}>패키징 완료 사진 (회원에게 안내됨)</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        {(preview || photoUrl) && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={preview ?? photoUrl ?? ''}
            alt="패키징 사진"
            className="packaging-photo-thumb"
          />
        )}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <input ref={inputRef} type="file" accept="image/*" onChange={pick} disabled={busy} />
          <button
            type="button"
            className="cta ghost"
            style={{ width: 'auto', padding: '8px 14px', fontSize: 12, alignSelf: 'flex-start', marginTop: 0 }}
            disabled={busy}
            onClick={upload}
          >
            {busy ? '업로드 중…' : photoUrl ? '재업로드' : '업로드'}
          </button>
        </div>
      </div>
      {err && <p className="hint err" style={{ margin: '4px 0 0', minHeight: 0 }}>{err}</p>}
    </div>
  );
}
