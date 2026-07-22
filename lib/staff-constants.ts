import type { Role } from '@lala/shared/lib/roles';

export type JobTitle =
  | '디렉터' | '슈퍼바이저' | '어드바이저' | '파트타임(매장)'
  | '배송팀장' | '배송직원' | '파트타임(배송)';

export const ALL_JOB_TITLES: JobTitle[] = [
  '디렉터', '슈퍼바이저', '어드바이저', '파트타임(매장)', '배송팀장', '배송직원', '파트타임(배송)',
];

export const ALL_ROLES: { value: Role; label: string }[] = [
  { value: 'director', label: 'director (전체 관리)' },
  { value: 'supervisor', label: 'supervisor (관리자)' },
  { value: 'delivery', label: 'delivery (배송)' },
];
