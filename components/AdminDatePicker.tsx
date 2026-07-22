'use client';

import { useEffect, useRef, useState } from 'react';

// 아이폰 달력 스타일 스크롤 휠(service/components/AccountDateFilter.tsx와 동일한 인터랙션,
// 데스크톱 admin에 맞게 크기만 키움) — 스크롤이 멈추면 가장 가까운 항목으로 스냅해 값을 확정한다.
const WHEEL_ITEM_H = 24;

const DOW = ['일', '월', '화', '수', '목', '금', '토'];
function withDow(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00`);
  return `${dateStr} (${DOW[d.getDay()]})`;
}
function pad2(n: number): string { return String(n).padStart(2, '0'); }
function isoOf(y: number, m: number, d: number): string { return `${y}-${pad2(m)}-${pad2(d)}`; }
function todayLocal(): Date { const n = new Date(); return new Date(n.getFullYear(), n.getMonth(), n.getDate()); }
function monthOf(dateStr: string | null): Date {
  const base = dateStr ? new Date(`${dateStr}T00:00:00`) : todayLocal();
  return new Date(base.getFullYear(), base.getMonth(), 1);
}

function WheelColumn({ items, value, suffix, onChange }: {
  items: number[]; value: number; suffix: string; onChange: (v: number) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const settleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const idx = items.indexOf(value);
    if (ref.current && idx >= 0) ref.current.scrollTop = idx * WHEEL_ITEM_H;
    // 마운트 시 1회만 — 이후엔 사용자 스크롤이 값을 결정한다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleScroll() {
    if (settleTimer.current) clearTimeout(settleTimer.current);
    settleTimer.current = setTimeout(() => {
      if (!ref.current) return;
      const idx = Math.round(ref.current.scrollTop / WHEEL_ITEM_H);
      const clamped = Math.max(0, Math.min(items.length - 1, idx));
      ref.current.scrollTo({ top: clamped * WHEEL_ITEM_H, behavior: 'smooth' });
      if (items[clamped] !== value) onChange(items[clamped]);
    }, 120);
  }

  return (
    <div className="admin-wheel-col" ref={ref} onScroll={handleScroll}>
      <div className="admin-wheel-pad" />
      {items.map((it) => (
        <div key={it} className={`admin-wheel-item${it === value ? ' active' : ''}`}>{it}{suffix}</div>
      ))}
      <div className="admin-wheel-pad" />
    </div>
  );
}

function MiniCalendar({ month, onNavigate, selected, onPick }: {
  month: Date; onNavigate: (next: Date) => void; selected: string | null; onPick: (iso: string) => void;
}) {
  const y = month.getFullYear();
  const m = month.getMonth();
  const firstDow = new Date(y, m, 1).getDay();
  const len = new Date(y, m + 1, 0).getDate();
  // 2026년 이전은 조회할 일이 없어서 휠 시작점을 2026으로 고정
  const years = Array.from({ length: 8 }, (_, i) => 2026 + i);
  const months = Array.from({ length: 12 }, (_, i) => i + 1);

  type Cell = { blank: true; key: string } | { blank: false; d: number; k: string };
  const cells: Cell[] = [];
  for (let i = 0; i < firstDow; i++) cells.push({ blank: true, key: `b${i}` });
  for (let d = 1; d <= len; d++) cells.push({ blank: false, d, k: isoOf(y, m + 1, d) });

  return (
    <div className="admin-datecal">
      <div className="admin-wheel-picker">
        <div className="admin-wheel-highlight" />
        <WheelColumn items={years} value={y} suffix="년" onChange={(yy) => onNavigate(new Date(yy, m, 1))} />
        <WheelColumn items={months} value={m + 1} suffix="월" onChange={(mm) => onNavigate(new Date(y, mm - 1, 1))} />
      </div>
      <div className="admin-datecal-dow"><span>일</span><span>월</span><span>화</span><span>수</span><span>목</span><span>금</span><span>토</span></div>
      <div className="admin-datecal-days">
        {cells.map((c) => c.blank
          ? <div key={c.key} className="admin-datecal-day blank" />
          : (
            <button type="button" key={c.k} className={`admin-datecal-day${c.k === selected ? ' sel' : ''}`} onClick={() => onPick(c.k)}>
              {c.d}
            </button>
          ))}
      </div>
    </div>
  );
}

/** 클릭 시 토글(다시 클릭하면 닫힘) + 바깥 클릭 시 닫힘. */
export default function AdminDatePicker({ value, onChange, placeholder }: {
  value: string; onChange: (v: string) => void; placeholder?: string;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [viewMonth, setViewMonth] = useState(() => monthOf(value || null));

  useEffect(() => {
    function onOutside(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onOutside);
    return () => document.removeEventListener('mousedown', onOutside);
  }, []);

  function toggle() {
    if (!open) setViewMonth(monthOf(value || null));
    setOpen((o) => !o);
  }

  return (
    <div className="admin-datefield" ref={wrapRef}>
      <button type="button" className="admin-search admin-datefield-btn" onClick={toggle}>
        {value ? withDow(value) : (placeholder || '날짜 선택')}
      </button>
      {open && (
        <MiniCalendar
          month={viewMonth}
          onNavigate={setViewMonth}
          selected={value || null}
          onPick={(k) => { onChange(k); setOpen(false); }}
        />
      )}
    </div>
  );
}
