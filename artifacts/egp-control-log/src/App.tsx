import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import {
  getGetPurchaseRecordFiltersQueryKey, getGetPurchaseRecordQueryKey, getGetPurchaseSummaryQueryKey,
  getGetPurchaseSyncStatusQueryKey, getListPurchaseRecordsQueryKey, useCreatePurchaseRecord,
  useDeletePurchaseRecord, useGetPurchaseRecord, useGetPurchaseRecordFilters, useGetPurchaseSummary,
  useGetPurchaseSyncStatus, useListPurchaseRecords, useSyncPurchaseRecords, useUpdatePurchaseRecord,
} from '@workspace/api-client-react';
import type { ListPurchaseRecordsParams, PurchaseRecord, PurchaseRecordInput, PurchaseRecordUpdate } from '@workspace/api-client-react';
import {
  ArrowDown, ArrowLeft, ArrowRight, Check, ChevronLeft, ChevronRight, ClipboardList, FilePlus2,
  FileText, LoaderCircle, PackageCheck, Pencil, Plus, RefreshCw, Search, ShieldCheck, Trash2, X,
} from 'lucide-react';
import { Link, Route, Switch, Router as WouterRouter, useLocation, useParams } from 'wouter';
import { ErrorBoundary } from '@/components/error-boundary';
import { Form } from '@/components/ui/form';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import { useForm } from 'react-hook-form';
import NotFound from '@/pages/not-found';
import './index.css';

const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: 15_000, retry: 1, refetchOnWindowFocus: false } } });
const blankRecord: PurchaseRecordInput = {
  projectNumber: '', poNumber: '', committeeNumber: '', requestDate: '', supplierCode: '', supplierName: '',
  taxId: '', recordStatus: 'unmarked', productName: '', companyDrugKey: '', quantity: null, unit: '',
  unitPrice: null, lineTotal: null, gpu: '', tpu: '', representative: '', contractNumber: '',
  deliveryStatus: 'FALSE', note: '', invoiceDate: '', acceptanceDate: '', invoiceNumber: '', acceptanceStatus: 'pending',
};

function AppShell({ children }: { children: ReactNode }) {
  return <div className="app-shell">
    <header className="topbar">
      <Link href="/" className="brand" aria-label="ไปทะเบียนจัดซื้อ" data-testid="link-brand">
        <span className="brand-mark"><ClipboardList size={20} /></span>
        <span className="brand-copy"><strong>ทะเบียนจัดซื้อยา</strong><small>ระบบติดตามพัสดุโรงพยาบาล</small></span>
      </Link>
      <nav className="main-nav" aria-label="เมนูหลัก">
        <Link href="/" className="nav-link" data-testid="link-register"><ClipboardList size={16} />ทะเบียนจัดซื้อ</Link>
        <Link href="/receiving" className="nav-link" data-testid="link-receiving"><PackageCheck size={16} />บันทึกรับยา</Link>
      </nav>
      <span className="system-state"><i />ข้อมูลจัดซื้อ</span>
    </header>
    <div className="page sync-shell"><SyncControl /></div>
    {children}
  </div>;
}
const nfmt = (v: number | null | undefined) => v == null || Number.isNaN(Number(v)) ? '—' : Number(v).toLocaleString('th-TH');
const money = (v: number | null | undefined) => v == null || Number.isNaN(Number(v)) ? '—' : Number(v).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fieldVal = (v: string | number | null | undefined) => v === '' || v == null ? '—' : String(v);
function recordLabel(v: string) { const s = (v || '').toLowerCase(); return s === 'verified' || s.includes('ตรวจสอบแล้ว') || s.includes('✔') ? 'ตรวจสอบแล้ว' : s === 'flagged' || s.includes('ต้องตรวจสอบ') || s.includes('❌') ? 'ต้องตรวจสอบ' : 'ยังไม่ระบุ'; }
function deliveryLabel(v: string) { const s = (v || '').trim().toLowerCase(); return s === 'true' || /deliver|received|รับแล้ว|ส่งครบ/.test(s) ? 'รับครบแล้ว' : 'รอรับยา'; }
function acceptanceLabel(v: string) { return /complete|accept|สำเร็จ|รับแล้ว|เสร็จ/.test((v || '').toLowerCase()) ? 'ตรวจรับแล้ว' : 'รอตรวจรับ'; }
function Pill({ children, tone = '' }: { children: ReactNode; tone?: string }) { return <span className={`status-pill ${tone}`}>{children}</span>; }
function Toast({ text }: { text: string }) { return text ? <div className="toast-message" role="status">{text}</div> : null; }
function useNotice() {
  const [text, setText] = useState('');
  const timer = useRef<number | undefined>(undefined);
  const notify = (s: string) => { setText(s); window.clearTimeout(timer.current); timer.current = window.setTimeout(() => setText(''), 3200); };
  return { text, notify };
}
function invalidateAll(qc: ReturnType<typeof useQueryClient>, id?: number) {
  void qc.invalidateQueries({ queryKey: getListPurchaseRecordsQueryKey() });
  void qc.invalidateQueries({ queryKey: getGetPurchaseSummaryQueryKey() });
  void qc.invalidateQueries({ queryKey: getGetPurchaseRecordFiltersQueryKey() });
  void qc.invalidateQueries({ queryKey: getGetPurchaseSyncStatusQueryKey() });
  if (id != null) void qc.invalidateQueries({ queryKey: getGetPurchaseRecordQueryKey(id) });
}
function Skeleton({ rows = 4 }: { rows?: number }) { return <div aria-label="กำลังโหลดข้อมูล">{Array.from({ length: rows }, (_, i) => <div className="loading-row" key={i} />)}</div>; }
function Metric({ title, value, sub, accent = false }: { title: string; value: string; sub: string; accent?: boolean }) {
  return <div className={`metric${accent ? ' metric-accent' : ''}`}><span>{title}</span><strong>{value}</strong><small>{sub}</small></div>;
}
function SyncControl() {
  const qc = useQueryClient();
  const status = useGetPurchaseSyncStatus();
  const sync = useSyncPurchaseRecords();
  const mutateRef = useRef(sync.mutate);
  mutateRef.current = sync.mutate;
  const doSync = () => mutateRef.current(undefined, {
    onSuccess: () => invalidateAll(qc),
  });
  useEffect(() => {
    doSync();
    const tick = window.setInterval(() => { if (document.visibilityState === 'visible') doSync(); }, 60_000);
    const visible = () => { if (document.visibilityState === 'visible') doSync(); };
    document.addEventListener('visibilitychange', visible);
    return () => { window.clearInterval(tick); document.removeEventListener('visibilitychange', visible); };
  }, []);
  const stamp = status.data?.lastSyncedAt ? new Date(status.data.lastSyncedAt).toLocaleString('th-TH', { dateStyle: 'medium', timeStyle: 'short' }) : 'ยังไม่มีข้อมูลการซิงก์';
  return <div className="sync-row">
    <span className={`sync-indicator ${sync.isError ? 'sync-error' : ''}`}><i />{sync.isPending ? 'กำลังปรับปรุงข้อมูล' : sync.isError ? 'ซิงก์ไม่สำเร็จ' : status.data?.configured ? 'แหล่งข้อมูลพร้อมใช้งาน' : 'ยังไม่ได้ตั้งค่าแหล่งข้อมูล'}</span>
    <span className="sync-time" data-testid="text-last-synced">ปรับปรุงล่าสุด {stamp}</span>
    <button className="button button-secondary sync-button" onClick={doSync} disabled={sync.isPending} aria-label="ปรับปรุงข้อมูลจากแหล่งข้อมูล" data-testid="button-sync">
      {sync.isPending ? <LoaderCircle size={15} className="spin" /> : <RefreshCw size={15} />}ปรับปรุงข้อมูล
    </button>
    {sync.isError && <span className="sync-alert" role="alert">ไม่สามารถซิงก์ข้อมูลได้ ลองปรับปรุงอีกครั้ง</span>}
  </div>;
}

const formSections: { title: string; fields: { key: keyof PurchaseRecordInput; label: string; type?: string; wide?: boolean; options?: string[] }[] }[] = [
  { title: 'ข้อมูลยาและราคา', fields: [
    { key: 'productName', label: 'ชื่อยา / รายการ', wide: true }, { key: 'companyDrugKey', label: 'รหัสยาบริษัท' },
    { key: 'quantity', label: 'จำนวน', type: 'number' }, { key: 'unit', label: 'หน่วยนับ' },
    { key: 'unitPrice', label: 'ราคาต่อหน่วย', type: 'number' }, { key: 'lineTotal', label: 'มูลค่ารวม', type: 'number' },
    { key: 'gpu', label: 'GPU' }, { key: 'tpu', label: 'TPU' },
  ] },
  { title: 'ข้อมูลการจัดซื้อ', fields: [
    { key: 'projectNumber', label: 'เลขที่โครงการ' }, { key: 'poNumber', label: 'เลขที่ใบสั่งซื้อ' },
    { key: 'committeeNumber', label: 'เลขที่คณะกรรมการ' }, { key: 'requestDate', label: 'วันที่ขอซื้อ' },
    { key: 'supplierCode', label: 'รหัสผู้ขาย' }, { key: 'supplierName', label: 'ชื่อผู้ขาย' },
    { key: 'taxId', label: 'เลขประจำตัวผู้เสียภาษี' }, { key: 'representative', label: 'ผู้แทนจำหน่าย' },
    { key: 'contractNumber', label: 'เลขที่สัญญา' }, { key: 'recordStatus', label: 'สถานะรายการ', options: ['unmarked', 'verified', 'flagged'] },
  ] },
  { title: 'การส่งมอบและตรวจรับ', fields: [
    { key: 'deliveryStatus', label: 'สถานะรับยา', options: ['FALSE', 'TRUE'] },
    { key: 'invoiceNumber', label: 'เลขที่ใบส่งของ' }, { key: 'invoiceDate', label: 'วันที่ใบส่งของ' },
    { key: 'acceptanceDate', label: 'วันที่ตรวจรับ' },
    { key: 'acceptanceStatus', label: 'สถานะตรวจรับ', options: ['pending', 'completed'] },
    { key: 'note', label: 'หมายเหตุ', wide: true },
  ] },
];
function displayOption(key: keyof PurchaseRecordInput, option: string) {
  if (key === 'recordStatus') return ({ unmarked: 'ยังไม่ระบุ', verified: 'ตรวจสอบแล้ว', flagged: 'ต้องตรวจสอบ' } as Record<string, string>)[option];
  if (key === 'deliveryStatus') return option === 'TRUE' ? 'รับครบแล้ว' : 'รอรับยา';
  if (key === 'acceptanceStatus') return option === 'completed' ? 'ตรวจรับแล้ว' : 'รอตรวจรับ';
  return option;
}
function RecordForm({ initial, onSave, saving, onCancel, submitLabel }: { initial: PurchaseRecordInput; onSave: (v: PurchaseRecordInput) => void; saving: boolean; onCancel: () => void; submitLabel: string }) {
  const form = useForm<PurchaseRecordInput>({ defaultValues: initial });
  const productName = form.watch('productName');
  return <Form {...form}><form onSubmit={form.handleSubmit(values => { if (values.productName.trim()) onSave(values); })}>
    {formSections.map(section => <section className="form-section" key={section.title}><h3>{section.title}</h3><div className="edit-grid">
      {section.fields.map(f => <div className={`form-field${f.wide ? ' wide' : ''}`} key={f.key}>
        <label htmlFor={`field-${f.key}`}>{f.label}{f.key === 'productName' ? ' *' : ''}</label>
        {f.key === 'note' ? <textarea id={`field-${f.key}`} data-testid={`input-${f.key}`} {...form.register(f.key)} />
          : f.options ? <select id={`field-${f.key}`} data-testid={`input-${f.key}`} {...form.register(f.key)}>{f.options.map(o => <option key={o} value={o}>{displayOption(f.key, o)}</option>)}</select>
          : <input id={`field-${f.key}`} data-testid={`input-${f.key}`} type={f.type || 'text'} step={f.type === 'number' ? 'any' : undefined} {...form.register(f.key, ['quantity', 'unitPrice', 'lineTotal'].includes(f.key) ? { setValueAs: value => value === '' ? null : Number(value) } : undefined)} />}
      </div>)}
    </div></section>)}
    <div className="form-footer"><button type="button" className="button button-secondary" onClick={onCancel} data-testid="button-cancel">ยกเลิก</button><button className="button button-primary" type="submit" disabled={saving || !productName?.trim()} data-testid="button-save">{saving && <LoaderCircle size={15} className="spin" />}{submitLabel}</button></div>
  </form></Form>;
}
function CreateDialog({ close, created, notify }: { close: () => void; created: (id: number) => void; notify: (s: string) => void }) {
  const create = useCreatePurchaseRecord();
  const qc = useQueryClient();
  return <div className="modal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget && !create.isPending) close(); }}><div className="modal" role="dialog" aria-modal="true" aria-labelledby="create-title">
      <div className="modal-head"><div><span className="eyebrow">รายการจัดซื้อใหม่</span><h2 id="create-title">เพิ่มรายการยา</h2></div><button className="close-button" aria-label="ปิด" onClick={close} data-testid="button-close-create"><X size={18} /></button></div>
    <div className="modal-body">{create.isError && <div className="notice" role="alert">บันทึกรายการไม่สำเร็จ กรุณาตรวจสอบข้อมูลแล้วลองอีกครั้ง</div>}
      <RecordForm initial={blankRecord} saving={create.isPending} submitLabel="สร้างรายการ" onCancel={close} onSave={data => create.mutate({ data }, { onSuccess: r => { invalidateAll(qc, r.id); notify('เพิ่มรายการแล้ว'); created(r.id); }, onError: () => notify('เพิ่มรายการไม่สำเร็จ') })} />
    </div></div></div>;
}

type SortField = NonNullable<ListPurchaseRecordsParams['sortBy']>;
const sortable: { key: SortField; label: string }[] = [
  { key: 'productName', label: 'ชื่อยา / รายการ' }, { key: 'poNumber', label: 'ใบสั่งซื้อ' },
  { key: 'supplierName', label: 'ผู้ขาย' }, { key: 'requestDate', label: 'วันที่ขอซื้อ' },
  { key: 'quantity', label: 'จำนวน' }, { key: 'lineTotal', label: 'มูลค่ารวม' },
  { key: 'recordStatus', label: 'ตรวจสอบ' }, { key: 'deliveryStatus', label: 'รับยา' },
];
function Register() {
  const [location, setLocation] = useLocation();
  const receiving = location === '/receiving';
  const [search, setSearch] = useState('');
  const [supplierCode, setSupplierCode] = useState('');
  const [recordStatus, setRecordStatus] = useState('');
  const [deliveryState, setDeliveryState] = useState(receiving ? 'pending' : '');
  const [productName, setProductName] = useState('');
  const [poNumber, setPoNumber] = useState('');
  const [requestDate, setRequestDate] = useState('');
  const [quantity, setQuantity] = useState('');
  const [lineTotal, setLineTotal] = useState('');
  const [sortBy, setSortBy] = useState<SortField>('requestDate');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');
  const [page, setPage] = useState(1);
  const [createOpen, setCreateOpen] = useState(false);
  const { text, notify } = useNotice();
  const activeDeliveryState = receiving ? 'pending' : deliveryState;
  const params = useMemo<ListPurchaseRecordsParams>(() => ({
    ...(search.trim() ? { q: search.trim() } : {}), ...(supplierCode ? { supplierCode } : {}),
    ...(recordStatus ? { recordStatus: recordStatus as 'verified' | 'flagged' | 'unmarked' } : {}),
    ...(activeDeliveryState ? { deliveryState: activeDeliveryState as 'delivered' | 'pending' } : {}),
    ...(productName ? { productName } : {}), ...(poNumber ? { poNumber } : {}),
    ...(requestDate ? { requestDate } : {}), ...(quantity ? { quantity } : {}),
    ...(lineTotal ? { lineTotal } : {}), sortBy, sortOrder, page, pageSize: 20,
  }), [search, supplierCode, recordStatus, activeDeliveryState, productName, poNumber, requestDate, quantity, lineTotal, sortBy, sortOrder, page]);
  const list = useListPurchaseRecords(params);
  const summary = useGetPurchaseSummary();
  const filters = useGetPurchaseRecordFilters();
  const total = list.data?.total ?? 0;
  const maxPage = Math.max(1, Math.ceil(total / (list.data?.pageSize || 20)));
  const clear = () => { setSearch(''); setSupplierCode(''); setRecordStatus(''); setDeliveryState(receiving ? 'pending' : ''); setProductName(''); setPoNumber(''); setRequestDate(''); setQuantity(''); setLineTotal(''); setPage(1); };
  const hasFilters = !!(search || supplierCode || recordStatus || (deliveryState && !receiving) || productName || poNumber || requestDate || quantity || lineTotal);
  const sortClick = (key: SortField) => { setSortOrder(sortBy === key && sortOrder === 'asc' ? 'desc' : 'asc'); setSortBy(key); setPage(1); };
  useEffect(() => { setDeliveryState(receiving ? 'pending' : ''); setPage(1); }, [receiving]);
  return <AppShell><main className="page">
    <div className="page-intro"><div className="intro-index">ระบบจัดซื้อยา <span> / </span>{receiving ? 'งานรับยา' : 'ภาพรวม'}</div>
      <div className="page-heading"><div><h1>{receiving ? 'บันทึกรับยา' : 'ทะเบียนจัดซื้อยา'}</h1><p className="lede">{receiving ? 'ค้นหารายการที่รอรับ บันทึกใบส่งของ และยืนยันการรับยา' : 'ติดตามรายการยาตั้งแต่ขอซื้อจนถึงการตรวจรับ'}</p></div>
        {!receiving && <button className="button button-primary" onClick={() => setCreateOpen(true)} data-testid="button-create-record"><Plus size={16} />เพิ่มรายการยา</button>}</div>
    </div>
    {!receiving && <section className="metrics" aria-label="สรุปการจัดซื้อ">
      {summary.isLoading ? <Skeleton rows={3} /> : summary.isError ? <div className="notice" role="alert">โหลดสรุปข้อมูลไม่สำเร็จ <button className="text-button" onClick={() => void summary.refetch()}>ลองอีกครั้ง</button></div> : <>
        <Metric title="รายการจัดซื้อ" value={nfmt(summary.data?.totalRecords)} sub={`${nfmt(summary.data?.supplierCount)} ผู้ขายในทะเบียน`} />
        <Metric title="มูลค่ารวม" value={`฿${money(summary.data?.totalValue)}`} sub="มูลค่าตามรายการที่มี" accent />
        <Metric title="รับยาแล้ว" value={nfmt(summary.data?.deliveredRecords)} sub={`รอรับ ${nfmt(summary.data?.pendingDeliveryRecords)} รายการ`} />
        <Metric title="ตรวจรับแล้ว" value={nfmt(summary.data?.completedAcceptanceRecords)} sub={`รอตรวจรับ ${nfmt(summary.data?.pendingAcceptanceRecords)} รายการ`} />
      </>}
    </section>}
    <section className="register-section">
      <div className="section-heading"><div><h2>{receiving ? 'รายการที่รอรับยา' : 'รายการทั้งหมด'}</h2><p>{receiving ? 'เลือกแถวเพื่อเปิดหน้าบันทึกรับยา' : 'ค้นหา กรอง และเรียงข้อมูลจากทะเบียนต้นทาง'}</p></div><span className="count-chip">{nfmt(total)} รายการ</span></div>
      <div className="list-panel">
        <div className="filterbar">
          <label className="search-wrap"><Search size={16} /><span className="sr-only">ค้นหาทุกรายการ</span><input className="control search-input" type="search" placeholder="ค้นหาชื่อยา เลขที่ใบสั่งซื้อ หรือผู้ขาย" value={search} onChange={e => { setSearch(e.target.value); setPage(1); }} data-testid="input-search" /></label>
          {hasFilters && <button className="button button-quiet" onClick={clear} data-testid="button-clear-filters">ล้างตัวกรอง</button>}
        </div>
        {list.isLoading ? <Skeleton /> : list.isError ? <div className="error-state" role="alert"><FileText size={24} /><h3>โหลดรายการไม่สำเร็จ</h3><p>ตรวจสอบการเชื่อมต่อแล้วลองใหม่อีกครั้ง</p><button className="button button-secondary" onClick={() => void list.refetch()}>ลองโหลดอีกครั้ง</button></div>
          : !list.data?.items?.length ? <div className="empty-state"><FilePlus2 size={25} /><h3>{receiving ? 'ไม่มีรายการที่รอรับยา' : hasFilters ? 'ไม่พบรายการที่ตรงกัน' : 'ยังไม่มีรายการจัดซื้อ'}</h3><p>{receiving ? 'รายการที่รอรับจากทะเบียนจะแสดงที่นี่' : hasFilters ? 'ลองเปลี่ยนคำค้นหาหรือล้างตัวกรอง' : 'เมื่อมีข้อมูลจากแหล่งข้อมูล รายการจะแสดงที่นี่'}</p>{hasFilters && <button className="button button-secondary" onClick={clear}>ล้างตัวกรอง</button>}</div>
            : <div className="table-scroll"><table className="records-table"><thead>
              <tr>{sortable.map(col => <th key={col.key} aria-sort={sortBy === col.key ? sortOrder === 'asc' ? 'ascending' : 'descending' : 'none'}><button className="sort-button" onClick={() => sortClick(col.key)} aria-label={`เรียงตาม${col.label} ${sortBy === col.key ? sortOrder === 'asc' ? 'จากน้อยไปมาก' : 'จากมากไปน้อย' : ''}`} data-testid={`button-sort-${col.key}`}>{col.label}{sortBy === col.key ? <ArrowDown size={13} className={sortOrder === 'asc' ? 'sort-up' : ''} /> : null}</button></th>)}<th aria-label="เปิดรายการ" /></tr>
              <tr className="column-filter-row">
                <th><input aria-label="กรองชื่อยา" placeholder="ชื่อยา" value={productName} onChange={e => { setProductName(e.target.value); setPage(1); }} data-testid="input-filter-product-name" /></th>
                <th><input aria-label="กรองเลขที่ใบสั่งซื้อ" placeholder="ใบสั่งซื้อ" value={poNumber} onChange={e => { setPoNumber(e.target.value); setPage(1); }} data-testid="input-filter-po-number" /></th>
                <th><select aria-label="กรองผู้ขาย" value={supplierCode} onChange={e => { setSupplierCode(e.target.value); setPage(1); }} data-testid="select-filter-supplier"><option value="">ผู้ขายทั้งหมด</option>{(filters.data?.suppliers || []).map(s => <option key={s.supplierCode} value={s.supplierCode}>{s.supplierName || s.supplierCode}</option>)}</select></th>
                <th><input aria-label="กรองวันที่ขอซื้อ" placeholder="วันที่ขอซื้อ" value={requestDate} onChange={e => { setRequestDate(e.target.value); setPage(1); }} data-testid="input-filter-request-date" /></th>
                <th><input aria-label="กรองจำนวน" placeholder="จำนวน" value={quantity} onChange={e => { setQuantity(e.target.value); setPage(1); }} data-testid="input-filter-quantity" /></th>
                <th><input aria-label="กรองมูลค่ารวม" placeholder="มูลค่ารวม" value={lineTotal} onChange={e => { setLineTotal(e.target.value); setPage(1); }} data-testid="input-filter-line-total" /></th>
                <th><select aria-label="กรองสถานะตรวจสอบ" value={recordStatus} onChange={e => { setRecordStatus(e.target.value); setPage(1); }} data-testid="select-filter-record-status"><option value="">ทั้งหมด</option><option value="verified">ตรวจสอบแล้ว</option><option value="flagged">ต้องตรวจสอบ</option><option value="unmarked">ยังไม่ระบุ</option></select></th>
                <th><select aria-label="กรองสถานะรับยา" value={activeDeliveryState} onChange={e => { setDeliveryState(e.target.value); setPage(1); }} data-testid="select-filter-delivery-status"><option value={receiving ? 'pending' : ''}>{receiving ? 'รอรับยา' : 'ทั้งหมด'}</option>{!receiving && <><option value="delivered">รับครบแล้ว</option><option value="pending">รอรับยา</option></>}</select></th>
                <th />
              </tr>
            </thead>
              <tbody>{list.data.items.map(r => <tr key={r.id} tabIndex={0} onClick={() => setLocation(receiving ? `/receiving/${r.id}` : `/records/${r.id}`)} onKeyDown={e => { if (e.key === 'Enter') setLocation(receiving ? `/receiving/${r.id}` : `/records/${r.id}`); }} data-testid={`row-record-${r.id}`}>
                <td><strong className="product-name">{fieldVal(r.productName)}</strong></td>
                <td><span className="mono">{fieldVal(r.poNumber)}</span></td>
                <td><strong className="supplier-name">{fieldVal(r.supplierName)}</strong></td>
                <td className="mono">{fieldVal(r.requestDate)}</td><td><span className="money">{nfmt(r.quantity)}</span><small className="subline">{fieldVal(r.unit)}</small></td>
                <td className="money">{r.lineTotal == null ? '—' : `฿${money(r.lineTotal)}`}</td>
                <td><Pill tone={recordLabel(r.recordStatus) === 'ตรวจสอบแล้ว' ? '' : recordLabel(r.recordStatus) === 'ต้องตรวจสอบ' ? 'flagged' : 'neutral'}>{recordLabel(r.recordStatus)}</Pill></td>
                <td><Pill tone={deliveryLabel(r.deliveryStatus) === 'รับครบแล้ว' ? '' : 'pending'}>{deliveryLabel(r.deliveryStatus)}</Pill></td><td><ArrowRight size={16} className="row-arrow" /></td>
              </tr>)}</tbody></table></div>}
        {!list.isLoading && !list.isError && !!list.data?.items?.length && <div className="pagination"><span>แสดง {((page - 1) * (list.data.pageSize || 20)) + 1}–{Math.min(page * (list.data.pageSize || 20), total)} จาก {nfmt(total)} รายการ</span><div className="page-actions">
          <button className="page-action" disabled={page <= 1} aria-label="หน้าก่อนหน้า" onClick={() => setPage(p => Math.max(1, p - 1))} data-testid="button-previous-page"><ChevronLeft size={16} /></button><span>หน้า {nfmt(page)} / {nfmt(maxPage)}</span><button className="page-action" disabled={page >= maxPage} aria-label="หน้าถัดไป" onClick={() => setPage(p => Math.min(maxPage, p + 1))} data-testid="button-next-page"><ChevronRight size={16} /></button>
        </div></div>}
      </div>
    </section>
    {!receiving && <footer className="page-footer"><span>ข้อมูลจากทะเบียนต้นทาง</span><span>ผู้ขายในระบบ {nfmt(summary.data?.supplierCount)} ราย</span></footer>}
    {createOpen && <CreateDialog close={() => setCreateOpen(false)} notify={notify} created={id => { setCreateOpen(false); setLocation(`/records/${id}`); }} />}
    <Toast text={text} />
  </main></AppShell>;
}

function inputFromRecord(r: PurchaseRecord): PurchaseRecordInput {
  return {
    projectNumber: r.projectNumber || '', poNumber: r.poNumber || '', committeeNumber: r.committeeNumber || '', requestDate: r.requestDate || '',
    supplierCode: r.supplierCode || '', supplierName: r.supplierName || '', taxId: r.taxId || '', recordStatus: r.recordStatus || '',
    productName: r.productName || '', companyDrugKey: r.companyDrugKey || '', quantity: r.quantity, unit: r.unit || '', unitPrice: r.unitPrice,
    lineTotal: r.lineTotal, gpu: r.gpu || '', tpu: r.tpu || '', representative: r.representative || '', contractNumber: r.contractNumber || '',
    deliveryStatus: r.deliveryStatus || 'FALSE', note: r.note || '', invoiceDate: r.invoiceDate || '', acceptanceDate: r.acceptanceDate || '',
    invoiceNumber: r.invoiceNumber || '', acceptanceStatus: r.acceptanceStatus || '',
  };
}
function DataField({ label, value, mono = false }: { label: string; value: ReactNode; mono?: boolean }) { return <div className="data-field"><span className="data-label">{label}</span><strong className={`data-value${mono ? ' mono' : ''}`}>{value || '—'}</strong></div>; }
function DetailPage() {
  const params = useParams<{ id: string }>();
  const id = Number(params.id);
  const [, setLocation] = useLocation();
  const qc = useQueryClient();
  const recordQuery = useGetPurchaseRecord(id, { query: { queryKey: getGetPurchaseRecordQueryKey(id), enabled: Number.isFinite(id) && id > 0 } });
  const update = useUpdatePurchaseRecord(); const remove = useDeletePurchaseRecord();
  const [editing, setEditing] = useState(false); const [confirmDelete, setConfirmDelete] = useState(false);
  const { text, notify } = useNotice(); const record = recordQuery.data;
  if (!Number.isFinite(id) || id < 1) return <AppShell><main className="page"><div className="error-state"><h2>ไม่พบรายการนี้</h2><Link href="/" className="button button-secondary">กลับทะเบียนจัดซื้อ</Link></div></main></AppShell>;
  return <AppShell><main className="page detail-page">
    <Link href="/" className="back-link"><ArrowLeft size={15} />กลับทะเบียนจัดซื้อ</Link>
    {recordQuery.isLoading ? <Skeleton /> : recordQuery.isError || !record ? <div className="error-state" role="alert"><FileText size={25} /><h2>เปิดรายการไม่ได้</h2><p>รายการอาจถูกลบ หรือไม่สามารถเชื่อมต่อข้อมูลได้</p><button className="button button-secondary" onClick={() => void recordQuery.refetch()}>ลองอีกครั้ง</button></div> : <>
      <div className="detail-heading"><div><span className="eyebrow">รายการจัดซื้อ #{record.id}</span><h1>{fieldVal(record.productName)}</h1><p className="lede">{fieldVal(record.supplierName)} <span className="divider-dot">•</span> ใบสั่งซื้อ <span className="mono">{fieldVal(record.poNumber)}</span></p></div>
        <div className="detail-actions"><button className="button button-secondary" onClick={() => setEditing(v => !v)}>{editing ? <X size={15} /> : <Pencil size={15} />}{editing ? 'ปิดการแก้ไข' : 'แก้ไขรายการ'}</button><button className="button button-danger" onClick={() => setConfirmDelete(true)}><Trash2 size={15} />ลบรายการ</button></div></div>
      <div className="detail-grid"><div>
        {editing ? <section className="detail-card"><div className="detail-card-head"><h2>แก้ไขข้อมูลรายการ</h2><span className="quiet-text">บันทึกเมื่อกดยืนยัน</span></div><div className="detail-card-body">
          {update.isError && <div className="notice" role="alert">บันทึกการแก้ไขไม่สำเร็จ กรุณาลองอีกครั้ง</div>}
          <RecordForm key={`${record.id}-${record.updatedAt}`} initial={inputFromRecord(record)} saving={update.isPending} submitLabel="บันทึกการแก้ไข" onCancel={() => setEditing(false)} onSave={v => update.mutate({ id, data: v as PurchaseRecordUpdate }, { onSuccess: () => { invalidateAll(qc, id); setEditing(false); notify('บันทึกการแก้ไขแล้ว'); }, onError: () => notify('บันทึกไม่สำเร็จ') })} />
        </div></section> : <>
          <section className="detail-card"><div className="detail-card-head"><h2>ข้อมูลยาและราคา</h2><span className="tag">{fieldVal(record.unit)}</span></div><div className="detail-card-body"><div className="field-grid">
            <DataField label="ชื่อยา / รายการ" value={record.productName} /><DataField label="รหัสยาบริษัท" value={record.companyDrugKey} mono />
            <DataField label="จำนวน" value={record.quantity == null ? '' : `${nfmt(record.quantity)} ${record.unit}`} /><DataField label="ราคาต่อหน่วย" value={record.unitPrice == null ? '' : `฿${money(record.unitPrice)}`} />
            <DataField label="มูลค่ารวม" value={record.lineTotal == null ? '' : `฿${money(record.lineTotal)}`} /><DataField label="GPU / TPU" value={[record.gpu, record.tpu].filter(Boolean).join(' / ')} /><DataField label="หมายเหตุ" value={record.note} />
          </div></div></section>
          <section className="detail-card"><div className="detail-card-head"><h2>ข้อมูลการจัดซื้อ</h2><Pill tone={recordLabel(record.recordStatus) === 'ตรวจสอบแล้ว' ? '' : recordLabel(record.recordStatus) === 'ต้องตรวจสอบ' ? 'flagged' : 'neutral'}>{recordLabel(record.recordStatus)}</Pill></div><div className="detail-card-body"><div className="field-grid">
            <DataField label="เลขที่โครงการ" value={record.projectNumber} mono /><DataField label="เลขที่ใบสั่งซื้อ" value={record.poNumber} mono /><DataField label="เลขที่คณะกรรมการ" value={record.committeeNumber} mono /><DataField label="วันที่ขอซื้อ" value={record.requestDate} mono /><DataField label="ผู้ขาย" value={record.supplierName} /><DataField label="รหัสผู้ขาย" value={record.supplierCode} mono /><DataField label="เลขประจำตัวผู้เสียภาษี" value={record.taxId} mono /><DataField label="ผู้แทนจำหน่าย" value={record.representative} /><DataField label="เลขที่สัญญา" value={record.contractNumber} mono /><DataField label="แถวในชีตต้นทาง" value={record.sourceSheetRow ?? ''} mono />
          </div></div></section>
        </>}
      </div>
      {!editing && <aside>
        <section className="detail-card"><div className="detail-card-head"><h2>การรับยาและตรวจรับ</h2><PackageCheck size={17} /></div><div className="detail-card-body">
          <div className="workflow"><div className={`workflow-item ${deliveryLabel(record.deliveryStatus) === 'รับครบแล้ว' ? 'done' : ''}`}><i /><div><strong>รับยา</strong><small>{deliveryLabel(record.deliveryStatus)}</small></div></div><div className={`workflow-item ${acceptanceLabel(record.acceptanceStatus) === 'ตรวจรับแล้ว' ? 'done' : ''}`}><i /><div><strong>ตรวจรับ</strong><small>{acceptanceLabel(record.acceptanceStatus)}</small></div></div></div>
          <div className="field-grid receipt-fields"><DataField label="เลขที่ใบส่งของ" value={record.invoiceNumber} mono /><DataField label="วันที่ใบส่งของ" value={record.invoiceDate} mono /><DataField label="วันที่ตรวจรับ" value={record.acceptanceDate} mono /></div>
          <Link href="/receiving" className="button button-secondary full-button">ไปหน้าบันทึกรับยา <ArrowRight size={15} /></Link>
        </div></section>
        <section className="detail-card"><div className="detail-card-head"><h2>ประวัติรายการ</h2><ShieldCheck size={17} /></div><div className="detail-card-body"><div className="field-grid"><DataField label="สร้างรายการเมื่อ" value={record.createdAt} mono /><DataField label="แก้ไขล่าสุด" value={record.updatedAt} mono /></div><p className="source-note">ข้อมูลจากชีตต้นทางจะปรับปรุงตามรอบซิงก์ ส่วนข้อมูลรับยาที่บันทึกบนเว็บจะถูกเก็บในรายการ</p></div></section>
      </aside>}
      </div>
    </>}
    {confirmDelete && record && <div className="modal-backdrop"><div className="modal confirm-modal" role="alertdialog" aria-modal="true" aria-labelledby="delete-title"><div className="confirm-mark"><Trash2 size={20} /></div><h2 id="delete-title">ยืนยันการลบรายการ</h2><p>ต้องการลบ <strong>{record.productName}</strong> ออกจากทะเบียนหรือไม่ การดำเนินการนี้ย้อนกลับไม่ได้</p>{remove.isError && <div className="notice" role="alert">ลบรายการไม่สำเร็จ กรุณาลองอีกครั้ง</div>}<div className="form-footer"><button className="button button-secondary" disabled={remove.isPending} onClick={() => setConfirmDelete(false)}>เก็บรายการไว้</button><button className="button button-danger" disabled={remove.isPending} onClick={() => remove.mutate({ id }, { onSuccess: () => { invalidateAll(qc, id); setLocation('/'); }, onError: () => notify('ลบรายการไม่สำเร็จ') })}>{remove.isPending && <LoaderCircle size={15} className="spin" />}ยืนยันลบ</button></div></div></div>}
    <Toast text={text} />
  </main></AppShell>;
}

function ReceivingDetail() {
  const params = useParams<{ id: string }>(); const id = Number(params.id);
  const [, setLocation] = useLocation(); const qc = useQueryClient();
  const query = useGetPurchaseRecord(id, { query: { queryKey: getGetPurchaseRecordQueryKey(id), enabled: Number.isFinite(id) && id > 0 } });
  const update = useUpdatePurchaseRecord(); const record = query.data;
  const form = useForm<{ invoiceNumber: string; invoiceDate: string }>({ defaultValues: { invoiceNumber: '', invoiceDate: '' } });
  const { text, notify } = useNotice();
  useEffect(() => { if (record) form.reset({ invoiceNumber: record.invoiceNumber || '', invoiceDate: record.invoiceDate || '' }); }, [record?.id]);
  if (!Number.isFinite(id) || id < 1) return <AppShell><main className="page"><div className="error-state"><h2>ไม่พบรายการนี้</h2><Link href="/receiving" className="button button-secondary">กลับไปบันทึกรับยา</Link></div></main></AppShell>;
  return <AppShell><main className="page receiving-page"><Link href="/receiving" className="back-link"><ArrowLeft size={15} />กลับรายการรอรับยา</Link>
    {query.isLoading ? <Skeleton rows={3} /> : query.isError || !record ? <div className="error-state" role="alert"><h2>เปิดรายการไม่ได้</h2><p>ตรวจสอบการเชื่อมต่อแล้วลองอีกครั้ง</p><button className="button button-secondary" onClick={() => void query.refetch()}>ลองอีกครั้ง</button></div> : <>
      <div className="receiving-banner"><div className="receive-icon"><PackageCheck size={23} /></div><div><span className="eyebrow">บันทึกรับยา</span><h1>{record.productName}</h1><p>{fieldVal(record.supplierName)} · ใบสั่งซื้อ <span className="mono">{fieldVal(record.poNumber)}</span></p></div><Pill tone={deliveryLabel(record.deliveryStatus) === 'รับครบแล้ว' ? '' : 'pending'}>{deliveryLabel(record.deliveryStatus)}</Pill></div>
      <div className="receiving-columns"><section className="detail-card"><div className="detail-card-head"><h2>รายละเอียดตามใบสั่งซื้อ</h2></div><div className="detail-card-body"><div className="field-grid">
        <DataField label="ชื่อยา / รายการ" value={record.productName} /><DataField label="รหัสยา" value={record.companyDrugKey} mono /><DataField label="จำนวนที่สั่ง" value={record.quantity == null ? '' : `${nfmt(record.quantity)} ${record.unit}`} /><DataField label="ราคาต่อหน่วย" value={record.unitPrice == null ? '' : `฿${money(record.unitPrice)}`} /><DataField label="มูลค่ารวม" value={record.lineTotal == null ? '' : `฿${money(record.lineTotal)}`} /><DataField label="เลขที่สัญญา" value={record.contractNumber} mono />
      </div></div></section>
      <section className="detail-card receive-form-card"><div className="detail-card-head"><h2>ข้อมูลใบส่งของและการรับ</h2><span className="saved-badge"><Check size={13} />บันทึกในทะเบียน</span></div><div className="detail-card-body">
        <p className="form-help">ข้อมูลที่บันทึกจะคงอยู่หลังออกจากหน้านี้ และแสดงในทะเบียนจัดซื้อ</p>
        {update.isError && <div className="notice" role="alert">บันทึกข้อมูลรับยาไม่สำเร็จ กรุณาลองอีกครั้ง</div>}
        <Form {...form}><form className="receipt-form" onSubmit={form.handleSubmit(values => { const data: PurchaseRecordUpdate = { ...values, deliveryStatus: 'TRUE' }; update.mutate({ id, data }, { onSuccess: () => { invalidateAll(qc, id); notify('บันทึกการรับยาแล้ว'); }, onError: () => notify('บันทึกไม่สำเร็จ') }); })}>
          <div className="form-field"><label htmlFor="receive-invoice">เลขที่ใบส่งของ</label><input id="receive-invoice" data-testid="input-receive-invoice" placeholder="ระบุเลขที่ใบส่งของ" {...form.register('invoiceNumber')} /></div>
          <div className="form-field"><label htmlFor="receive-date">วันที่ใบส่งของ</label><input id="receive-date" data-testid="input-receive-date" placeholder="เช่น 14/9/2026" {...form.register('invoiceDate')} /></div>
          <div className="delivery-confirm"><div><strong>ยืนยันรับยาครบตามรายการ</strong><small>สถานะการส่งมอบจะเปลี่ยนเป็นรับครบแล้ว</small></div><button type="submit" className="button button-primary" disabled={update.isPending} data-testid="button-save-receiving">{update.isPending ? <LoaderCircle size={15} className="spin" /> : <Check size={15} />}บันทึกการรับยา</button></div>
        </form></Form>
        {record.updatedAt && <p className="saved-note">บันทึกล่าสุด {new Date(record.updatedAt).toLocaleString('th-TH', { dateStyle: 'medium', timeStyle: 'short' })}</p>}
      </div></section></div>
    </>}
    <Toast text={text} />
  </main></AppShell>;
}
function RoutedBoundary({ children }: { children: ReactNode }) { const [location] = useLocation(); return <ErrorBoundary resetKey={location}>{children}</ErrorBoundary>; }
function Router() { return <RoutedBoundary><Switch><Route path="/" component={Register} /><Route path="/records/:id" component={DetailPage} /><Route path="/receiving" component={Register} /><Route path="/receiving/:id" component={ReceivingDetail} /><Route component={NotFound} /></Switch></RoutedBoundary>; }
function App() { return <QueryClientProvider client={queryClient}><TooltipProvider><WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}><Router /></WouterRouter><Toaster /></TooltipProvider></QueryClientProvider>; }
export default App;