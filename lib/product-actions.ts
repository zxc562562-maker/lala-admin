'use server';

import { revalidatePath } from 'next/cache';
import { supabaseAdmin } from '@lala/shared/lib/supabase/server';
import { getAccess } from '@lala/shared/lib/roles';
import { canTransition, type ItemStatus } from '@lala/shared/lib/domain/inventory';
import type { Product } from '@lala/shared/lib/types';

const PRODUCT_SELECT = 'id,name,brand,category,size,daily_price,deposit,color_1,color_2';

function mapProduct(r: {
  id: string; name: string; brand: string | null; category: string; size: string;
  daily_price: number; deposit: number; color_1: string | null; color_2: string | null;
}): Product {
  return {
    id: r.id, name: r.name, brand: r.brand ?? '', category: r.category, size: r.size,
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

export interface ProductRow extends Product { itemCount: number }

/** 상품 목록 (재고 개체 수 포함) */
export async function listProducts(): Promise<ProductRow[]> {
  const me = await getAccess();
  if (!me?.isApprover) return [];

  const sb = supabaseAdmin();
  const { data, error } = await sb
    .from('product')
    .select(`${PRODUCT_SELECT},inventory_item(count)`)
    .order('created_at', { ascending: false });
  if (error || !data) return [];

  return (data as unknown as Array<Parameters<typeof mapProduct>[0] & { inventory_item: { count: number }[] }>).map((r) => ({
    ...mapProduct(r),
    itemCount: r.inventory_item?.[0]?.count ?? 0,
  }));
}

export async function getProduct(id: string): Promise<Product | null> {
  const me = await getAccess();
  if (!me?.isApprover) return null;

  const sb = supabaseAdmin();
  const { data, error } = await sb.from('product').select(PRODUCT_SELECT).eq('id', id).maybeSingle();
  if (error || !data) return null;
  return mapProduct(data);
}

export interface ProductInput {
  name: string; brand: string; category: string; size: string; dailyPrice: number; deposit: number; c1: string; c2: string;
}

export async function createProduct(input: ProductInput): Promise<{ ok: boolean; reason?: string; id?: string }> {
  const me = await getAccess();
  if (!me?.isApprover) return { ok: false, reason: '권한이 없습니다.' };

  const sb = supabaseAdmin();
  const { data, error } = await sb.from('product').insert({
    name: input.name, brand: input.brand || null, category: input.category, size: input.size,
    daily_price: input.dailyPrice, deposit: input.deposit, color_1: input.c1, color_2: input.c2,
  }).select('id').single();
  if (error) return { ok: false, reason: '이미 같은 이름·사이즈의 상품이 있거나 저장에 실패했어요.' };

  revalidatePath('/admin/products');
  return { ok: true, id: data.id };
}

export async function updateProduct(id: string, input: ProductInput): Promise<{ ok: boolean; reason?: string }> {
  const me = await getAccess();
  if (!me?.isApprover) return { ok: false, reason: '권한이 없습니다.' };

  const sb = supabaseAdmin();
  const { error } = await sb.from('product').update({
    name: input.name, brand: input.brand || null, category: input.category, size: input.size,
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

export async function createInventoryItem(productId: string, barcode: string): Promise<{ ok: boolean; reason?: string }> {
  const me = await getAccess();
  if (!me?.isApprover) return { ok: false, reason: '권한이 없습니다.' };
  if (!barcode.trim()) return { ok: false, reason: '바코드를 입력해주세요.' };

  const sb = supabaseAdmin();
  const { error } = await sb.from('inventory_item').insert({
    product_id: productId, barcode: barcode.trim(), status: 'AVAILABLE',
  });
  if (error) return { ok: false, reason: '이미 같은 바코드가 있거나 저장에 실패했어요.' };

  revalidatePath(`/admin/products/${productId}`);
  revalidatePath('/admin/inventory');
  return { ok: true };
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
}

export async function listInventoryItems(filter?: InventoryListFilter): Promise<InventoryListRow[]> {
  const me = await getAccess();
  if (!me?.isApprover) return [];

  const sb = supabaseAdmin();
  let q = sb.from('inventory_item').select(`${ITEM_SELECT},product:product_id(name,category,size)`);
  if (filter?.status) q = q.eq('status', filter.status);
  const { data, error } = await q.order('created_at', { ascending: false });
  if (error || !data) return [];

  const rows = (data as unknown as Array<Parameters<typeof mapItem>[0] & { product: { name: string; category: string; size: string } | null }>).map((r) => ({
    ...mapItem(r),
    productName: r.product?.name ?? '(삭제된 상품)',
    productCategory: r.product?.category ?? '—',
    productSize: r.product?.size ?? '—',
  }));

  const search = filter?.search?.trim().toLowerCase();
  if (!search) return rows;
  return rows.filter((r) => r.barcode.toLowerCase().includes(search) || r.productName.toLowerCase().includes(search));
}
