import type { Metadata, Viewport } from 'next';
import { Cormorant_Garamond, Pinyon_Script, Tenor_Sans, Noto_Sans_KR } from 'next/font/google';
import './globals.css';

const cormorant = Cormorant_Garamond({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  style: ['normal', 'italic'],
  variable: '--serif',
  display: 'swap',
});

// 워드마크(로고)용 필기체
const pinyon = Pinyon_Script({
  subsets: ['latin'],
  weight: '400',
  variable: '--script',
  display: 'swap',
});

// 본문 폰트 — 자체 호스팅(빌드 시 다운로드해 로컬 서빙)으로 구글 폰트 외부 요청 제거
const tenorSans = Tenor_Sans({
  subsets: ['latin'],
  weight: '400',
  variable: '--font-tenor',
  display: 'swap',
});

const notoSansKr = Noto_Sans_KR({
  subsets: ['latin'],
  weight: ['300', '400', '500', '700'],
  variable: '--font-noto-kr',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'Lala — 룩북 대여',
  description: '하루를 위한 옷, 사지 않고 빌립니다.',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="ko"
      className={`${cormorant.variable} ${pinyon.variable} ${tenorSans.variable} ${notoSansKr.variable}`}
    >
      <body>{children}</body>
    </html>
  );
}
