'use server';

import { revalidatePath } from 'next/cache';
import { supabaseAdmin } from '@lala/shared/lib/supabase/server';
import { getAccess } from '@lala/shared/lib/roles';
import { canTransition, type ItemStatus } from '@lala/shared/lib/domain/inventory';
import type { Product } from '@lala/shared/lib/types';

const PRODUCT_SELECT = 'id,name,brand,category,size,color_name,daily_price,deposit,color_1,color_2';

/** service 앱과 공유하는 Product 타입엔 없는 색상명(바코드 생성용, 영문)을 admin 전용으로 얹은 타입. */
export interface AdminProduct extends Product { colorName: string | null }

function mapProduct(r: {
  id: string; name: string; brand: string | null; category: string; size: string; color_name: string | null;
  daily_price: number; deposit: number; color_1: string | null; color_2: string | null;
}): AdminProduct {
  return {
    id: r.id, name: r.name, brand: r.brand ?? '', category: r.category, size: r.size,
    colorName: r.color_name,
    dailyPrice: r.daily_price, deposit: r.deposit,
    c1: r.color_1 ?? '#3B2230', c2: r.color_2 ?? '#6B2737',
  };
}

export interface AdminInventoryItem {
  id: string;
  productId: string;
  barcode: string;
  status: ItemStatus;
  condition: number;
  rentalCount: number;
}

function mapItem(r: {
  id: string; product_id: string; barcode: string; status: ItemStatus; condition: number; rental_count: number;
}): AdminInventoryItem {
  return {
    id: r.id, productId: r.product_id, barcode: r.barcode,
    status: r.status, condition: r.condition, rentalCount: r.rental_count,
  };
}

export interface ProductRow extends AdminProduct { itemCount: number; barcodes: string[] }

/** 상품 목록 (재고 개체 수·바코드 목록 포함) */
export async function listProducts(): Promise<ProductRow[]> {
  const me = await getAccess();
  if (!me?.isApprover) return [];

  const sb = supabaseAdmin();
  const { data, error } = await sb
    .from('product')
    .select(`${PRODUCT_SELECT},inventory_item(barcode)`)
    .order('created_at', { ascending: false });
  if (error || !data) return [];

  return (data as unknown as Array<Parameters<typeof mapProduct>[0] & { inventory_item: { barcode: string }[] }>).map((r) => ({
    ...mapProduct(r),
    itemCount: r.inventory_item?.length ?? 0,
    barcodes: (r.inventory_item ?? []).map((i) => i.barcode),
  }));
}

export async function getProduct(id: string): Promise<AdminProduct | null> {
  const me = await getAccess();
  if (!me?.isApprover) return null;

  const sb = supabaseAdmin();
  const { data, error } = await sb.from('product').select(PRODUCT_SELECT).eq('id', id).maybeSingle();
  if (error || !data) return null;
  return mapProduct(data);
}

// 카테고리별 Code128 바코드 접두어. 목록에 없는 카테고리는 일반 접두어(PR)로 대체.
const CATEGORY_PREFIX: Record<string, string> = {
  '자켓': 'JK', '블라우스': 'BL', '치마': 'SK', '원피스': 'DR', '구두': 'HE', '백': 'BA',
};
function categoryPrefix(category: string): string {
  return CATEGORY_PREFIX[category] ?? 'PR';
}

function pad2(n: number): string { return String(n).padStart(2, '0'); }
function todayCompact(): string {
  const d = new Date();
  return `${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}`;
}
// Code128은 ASCII만 인코딩 가능 — 색상명·사이즈에 남아있을 수 있는 특수문자/공백/비영문을 제거.
function sanitizeForBarcode(s: string): string {
  return s.trim().toUpperCase().replace(/[^A-Z0-9]/g, '') || 'NA';
}

/**
 * 바코드 값: {카테고리 접두어}{등록일자YYYYMMDD}-{컬러}-{사이즈}-{순번}.
 * 순번은 같은 상품에 같은 날 여러 개체를 추가할 때(치수·컬러가 같아 나머지가 겹치는 경우) 구분용.
 */
function buildBarcodeValue(category: string, colorName: string, size: string, seq: number): string {
  const prefix = categoryPrefix(category);
  const date = todayCompact();
  const color = sanitizeForBarcode(colorName);
  const sz = sanitizeForBarcode(size);
  return `${prefix}${date}-${color}-${sz}-${pad2(seq)}`;
}

/**
 * 재고 개체 1건을 자동생성 바코드로 삽입. unique 충돌(23505) 시엔 순번을 올려 재시도,
 * 그 외 오류는 바로 포기. createProduct(첫 개체 자동생성)와 createInventoryItem이 공유.
 */
async function insertAutoBarcodeItem(
  sb: ReturnType<typeof supabaseAdmin>,
  productId: string,
  category: string,
  colorName: string,
  size: string,
  startSeq: number,
): Promise<{ ok: true; barcode: string } | { ok: false }> {
  let seq = startSeq;
  for (let attempt = 0; attempt < 5; attempt++) {
    const barcode = buildBarcodeValue(category, colorName, size, seq);
    const { error } = await sb.from('inventory_item').insert({ product_id: productId, barcode, status: 'AVAILABLE' });
    if (!error) return { ok: true, barcode };
    if (error.code !== '23505') return { ok: false };
    seq++;
  }
  return { ok: false };
}

// 브랜드는 관리 대상에서 제외 — 신규 상품엔 값을 넣지 않고(기존 값 있는 상품도 수정 시 손대지 않음),
// service 앱은 여전히 Product.brand를 표시하므로 컬럼/타입 자체는 그대로 둔다.
// colorName은 바코드 값(카테고리 접두어+등록일자+컬러+사이즈) 생성에 쓰이는 색상명 — Code128은
// ASCII만 인코딩 가능하므로 영문/숫자로 입력받는다. 등록 즉시 바코드가 나와야 하니 필수값.
export interface ProductInput {
  name: string; category: string; size: string; colorName: string; dailyPrice: number; deposit: number; c1: string; c2: string;
}

export async function createProduct(input: ProductInput): Promise<{ ok: boolean; reason?: string; id?: string }> {
  const me = await getAccess();
  if (!me?.isApprover) return { ok: false, reason: '권한이 없습니다.' };
  const colorName = input.colorName.trim();
  if (!colorName) return { ok: false, reason: '색상명을 입력해주세요(바코드 생성에 필요해요).' };

  const sb = supabaseAdmin();
  const { data, error } = await sb.from('product').insert({
    name: input.name, category: input.category, size: input.size, color_name: colorName,
    daily_price: input.dailyPrice, deposit: input.deposit, color_1: input.c1, color_2: input.c2,
  }).select('id').single();
  if (error) return { ok: false, reason: '이미 같은 이름·사이즈의 상품이 있거나 저장에 실패했어요.' };

  // 등록 직후 바코드가 공란으로 보이면 혼란스럽다는 피드백 반영 — 첫 재고 개체를 바로 만들어준다.
  await insertAutoBarcodeItem(sb, data.id, input.category, colorName, input.size, 1);

  revalidatePath('/admin/products');
  return { ok: true, id: data.id };
}

export async function updateProduct(id: string, input: ProductInput): Promise<{ ok: boolean; reason?: string }> {
  const me = await getAccess();
  if (!me?.isApprover) return { ok: false, reason: '권한이 없습니다.' };
  const colorName = input.colorName.trim();
  if (!colorName) return { ok: false, reason: '색상명을 입력해주세요(바코드 생성에 필요해요).' };

  const sb = supabaseAdmin();
  const { error } = await sb.from('product').update({
    name: input.name, category: input.category, size: input.size, color_name: colorName,
    daily_price: input.dailyPrice, deposit: input.deposit, color_1: input.c1, color_2: input.c2,
  }).eq('id', id);
  if (error) return { ok: false, reason: '저장에 실패했어요.' };

  revalidatePath('/admin/products');
  revalidatePath(`/admin/products/${id}`);
  return { ok: true };
}

const ITEM_SELECT = 'id,product_id,barcode,status,condition,rental_count';

export async function listInventoryItemsForProduct(productId: string): Promise<AdminInventoryItem[]> {
  const me = await getAccess();
  if (!me?.isApprover) return [];

  const sb = supabaseAdmin();
  const { data, error } = await sb.from('inventory_item').select(ITEM_SELECT).eq('product_id', productId).order('created_at');
  if (error || !data) return [];
  return data.map(mapItem);
}

/**
 * 같은 상품이라도 실물이 여러 벌이면(사이즈별 컨디션·대여현황을 따로 추적해야 하니) 재고 개체마다
 * 고유 바코드가 필요함 — 수기 입력은 오탈자/중복 위험이 있어 서버에서 자동 생성한다.
 */
export async function createInventoryItem(productId: string): Promise<{ ok: true; barcode: string } | { ok: false; reason: string }> {
  const me = await getAccess();
  if (!me?.isApprover) return { ok: false, reason: '권한이 없습니다.' };

  const sb = supabaseAdmin();
  const { data: product, error: pErr } = await sb.from('product').select('category,color_name,size').eq('id', productId).maybeSingle();
  if (pErr || !product) return { ok: false, reason: '상품을 찾을 수 없습니다.' };
  if (!product.color_name?.trim()) return { ok: false, reason: '상품에 색상명이 등록되어 있지 않아요. 상품 정보를 먼저 수정해주세요.' };

  const { count } = await sb.from('inventory_item').select('id', { count: 'exact', head: true }).eq('product_id', productId);
  const result = await insertAutoBarcodeItem(sb, productId, product.category, product.color_name, product.size, (count ?? 0) + 1);
  if (!result.ok) return { ok: false, reason: '바코드 생성에 실패했어요. 다시 시도해주세요.' };

  revalidatePath(`/admin/products/${productId}`);
  revalidatePath('/admin/inventory');
  return { ok: true, barcode: result.barcode };
}

export async function updateInventoryItemStatus(itemId: string, to: ItemStatus): Promise<{ ok: boolean; reason?: string }> {
  const me = await getAccess();
  if (!me?.isApprover) return { ok: false, reason: '권한이 없습니다.' };

  const sb = supabaseAdmin();
  const { data: current, error: e1 } = await sb.from('inventory_item').select('id,product_id,status').eq('id', itemId).maybeSingle();
  if (e1 || !current) return { ok: false, reason: '재고 개체를 찾을 수 없습니다.' };
  if (!canTransition(current.status as ItemStatus, to)) {
    return { ok: false, reason: `${current.status} → ${to}로 바꿀 수 없습니다.` };
  }

  const patch: { status: ItemStatus; rental_count?: number } = { status: to };
  if (to === 'RENTED') {
    const { data: row } = await sb.from('inventory_item').select('rental_count').eq('id', itemId).single();
    patch.rental_count = (row?.rental_count ?? 0) + 1;
  }

  const { error } = await sb.from('inventory_item').update(patch).eq('id', itemId);
  if (error) return { ok: false, reason: '상태 변경에 실패했어요.' };

  revalidatePath(`/admin/products/${current.product_id}`);
  revalidatePath('/admin/inventory');
  return { ok: true };
}

export interface InventoryListFilter { status?: ItemStatus; search?: string }

export interface InventoryListRow extends AdminInventoryItem {
  productName: string;
  productCategory: string;
  productSize: string;
  c1: string;
  c2: string;
}

export async function listInventoryItems(filter?: InventoryListFilter): Promise<InventoryListRow[]> {
  const me = await getAccess();
  if (!me?.isApprover) return [];

  const sb = supabaseAdmin();
  let q = sb.from('inventory_item').select(`${ITEM_SELECT},product:product_id(name,category,size,color_1,color_2)`);
  if (filter?.status) q = q.eq('status', filter.status);
  const { data, error } = await q.order('created_at', { ascending: false });
  if (error || !data) return [];

  const rows = (data as unknown as Array<Parameters<typeof mapItem>[0] & { product: { name: string; category: string; size: string; color_1: string | null; color_2: string | null } | null }>).map((r) => ({
    ...mapItem(r),
    productName: r.product?.name ?? '(삭제된 상품)',
    productCategory: r.product?.category ?? '—',
    productSize: r.product?.size ?? '—',
    c1: r.product?.color_1 ?? '#3B2230',
    c2: r.product?.color_2 ?? '#6B2737',
  }));

  const search = filter?.search?.trim().toLowerCase();
  if (!search) return rows;
  return rows.filter((r) => r.barcode.toLowerCase().includes(search) || r.productName.toLowerCase().includes(search));
}
