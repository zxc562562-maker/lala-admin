import type { Metadata, Viewport } from 'next';
import { Cormorant_Garamond, Pinyon_Script } from 'next/font/google';
import localFont from 'next/font/local';
import './globals.css';

const cormorant = Cormorant_Garamond({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  style: ['normal', 'italic'],
  variable: '--serif',
  display: 'swap',
});

// 워드마크(로고)용 필기체 — 로그인 화면 브랜드 표기에만 사용
const pinyon = Pinyon_Script({
  subsets: ['latin'],
  weight: '400',
  variable: '--script',
  display: 'swap',
});

// 본문 폰트 — 직원이 모니터를 오래 보는 화면이라 시인성이 최우선. Tenor Sans(브랜드용 장식 서체) 대신
// 한국 UI/대시보드에서 화면 가독성 기준으로 표준처럼 쓰이는 Pretendard(가변 폰트)로 교체.
const pretendard = localFont({
  src: '../../node_modules/pretendard/dist/web/variable/woff2/PretendardVariable.woff2',
  variable: '--font-pretendard',
  weight: '45 920',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'Lala - Admin',
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
      className={`${cormorant.variable} ${pinyon.variable} ${pretendard.variable}`}
    >
      <body>{children}</body>
    </html>
  );
}
