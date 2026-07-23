'use client';

import { useEffect, useRef } from 'react';
import JsBarcode from 'jsbarcode';

/** 재고 개체 바코드를 실제 스캔 가능한 Code128 그래픽으로 렌더링(값 텍스트도 아래에 함께 표시). */
export default function BarcodeImage({ value, height = 32 }: { value: string; height?: number }) {
  const ref = useRef<SVGSVGElement>(null);

  useEffect(() => {
    if (!ref.current) return;
    try {
      JsBarcode(ref.current, value, {
        format: 'CODE128',
        width: 1.3,
        height,
        displayValue: true,
        fontSize: 10.5,
        margin: 4,
      });
    } catch {
      // Code128로 인코딩 불가능한 값(비ASCII 등) — 빈 상태로 둠
    }
  }, [value, height]);

  return <svg ref={ref} />;
}
