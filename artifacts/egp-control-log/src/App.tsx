import { type ReactNode, useMemo, useState } from 'react';
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import NotFound from '@/pages/not-found';
import {
  useCreatePurchaseRecord, useDeletePurchaseRecord, useGetPurchaseRecord,
  useGetPurchaseRecordFilters, useGetPurchaseSummary, useListPurchaseRecords,
  useUpdatePurchaseRecord, getGetPurchaseRecordQueryKey,
  getGetPurchaseSummaryQueryKey, getGetPurchaseRecordFiltersQueryKey,
  getListPurchaseRecordsQueryKey,
} from '@workspace/api-client-react';
import type { PurchaseRecord, PurchaseRecordInput, PurchaseRecordUpdate } from '@workspace/api-client-react';
import {
  ArrowLeft, ArrowRight, ChevronLeft, ChevronRight,
  ClipboardList, FilePlus2, FileText, LoaderCircle, PackageCheck, Pencil,
  Plus, Search, ShieldCheck, Trash2, X,
} from 'lucide-react';
import { Link, Route, Switch, Router as WouterRouter, useLocation, useParams } from 'wouter';
import './index.css';

const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: 20_000, retry: 1, refetchOnWindowFocus: false } } });

const blankRecord: PurchaseRecordInput = {
  projectNumber: '', poNumber: '', committeeNumber: '', requestDate: '',
  supplierCode: '', supplierName: '', taxId: '', recordStatus: '',
  productName: '', companyDrugKey: '', quantity: null, unit: '',
  unitPrice: null, lineTotal: null, gpu: '', tpu: '', representative: '',
  contractNumber: '', deliveryStatus: 'FALSE', note: '', invoiceDate: '',
  acceptanceDate: '', invoiceNumber: '', acceptanceStatus: 'pending',
};

function AppShell({ children }: { children: ReactNode }) {
  return <div className="app-shell">
    <header className="topbar">
      <Link href="/" className="brand" data-testid="link-home">
        <span className="brand-mark"><ClipboardList size={19} strokeWidth={1.8} /></span>
        <span className="brand-copy"><span className="brand-name">e-GP Purchase Tracker</span><span className="brand-sub">Procurement workspace</span></span>
      </Link>
      <div className="top-right"><span className="system-label"><span className="live-dot" />Hospital procurement</span><span className="avatar">GP</span></div>
    </header>
    {children}
  </div>;
}

function money(value: number | null | undefined) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return '—';
  return new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(value));
}
function count(value: number | undefined) { return Number(value || 0).toLocaleString('en-US'); }
function statusClass(value: string, kind: 'record' | 'delivery' | 'acceptance' = 'record') {
  const s = (value || '').toLowerCase();
  if (kind === 'record') return s === 'verified' || s.includes('✔') ? '' : s === 'flagged' || s.includes('❌') ? 'flagged' : 'neutral';
  if (kind === 'delivery' && s.trim() === 'true') return '';
  if (kind === 'delivery' && s.trim() === 'false') return 'pending';
  return /deliver|complete|accept|received|สำเร็จ|เสร็จ|ส่งครบ|รับแล้ว|✔/.test(s) ? '' : /reject|flag|ไม่/.test(s) ? 'flagged' : 'pending';
}
function recordStatusLabel(value: string) {
  const status = value.trim().toLowerCase();
  return status === 'verified' || status.includes('✔') ? 'Verified'
    : status === 'flagged' || status.includes('❌') ? 'Flagged'
    : 'Unmarked';
}
function deliveryStatusLabel(value: string) {
  const status = value.trim().toLowerCase();
  if (status === 'true') return 'Delivered';
  if (status === 'false' || status === 'pending' || !status) return 'Pending';
  return value;
}
function Field({ label, value, mono = false }: { label: string; value: ReactNode; mono?: boolean }) {
  return <div className="data-field"><div className="data-label">{label}</div><div className={`data-value${mono ? ' mono' : ''}${value === '' || value === null || value === undefined ? ' muted' : ''}`}>{value || '—'}</div></div>;
}
function SummaryCard({ label, value, foot, gold = false }: { label: string; value: string; foot: string; gold?: boolean }) {
  return <div className={`summary-card${gold ? ' gold' : ''}`} data-testid={`summary-${label.toLowerCase().replaceAll(' ', '-')}`}>
    <div className="summary-label">{label}</div><div className="summary-value">{value}</div><div className="summary-foot">{foot}</div>
  </div>;
}
function LoadingBlock() { return <div aria-label="Loading records"><div className="loading-row" /><div className="loading-row" /><div className="loading-row" /><div className="loading-row" /></div>; }

function Toast({ message }: { message: string }) {
  return message ? <div className="toast-message" role="status" data-testid="status-toast">{message}</div> : null;
}
function useToastMessage() {
  const [message, setMessage] = useState('');
  const notify = (text: string) => { setMessage(text); window.setTimeout(() => setMessage(''), 3200); };
  return { message, notify };
}

function RecordForm({ initial, onSave, saving, onCancel, submitLabel }: {
  initial: PurchaseRecordInput; onSave: (value: PurchaseRecordInput) => void; saving: boolean; onCancel: () => void; submitLabel: string;
}) {
  const [form, setForm] = useState<PurchaseRecordInput>(initial);
  const set = (key: keyof PurchaseRecordInput, value: string) => setForm(current => ({
    ...current, [key]: key === 'quantity' || key === 'unitPrice' || key === 'lineTotal' ? (value.trim() === '' ? null : Number(value)) : value,
  } as PurchaseRecordInput));
  const sections: { title: string; fields: { key: keyof PurchaseRecordInput; label: string; type?: string; wide?: boolean; options?: string[] }[] }[] = [
    { title: 'Medicine & pricing', fields: [
      { key: 'productName', label: 'Medicine / product name', wide: true }, { key: 'companyDrugKey', label: 'Company drug key' },
      { key: 'quantity', label: 'Quantity', type: 'number' }, { key: 'unit', label: 'Unit' },
      { key: 'unitPrice', label: 'Unit price', type: 'number' }, { key: 'lineTotal', label: 'Line total', type: 'number' },
      { key: 'gpu', label: 'GPU' }, { key: 'tpu', label: 'TPU' },
    ] },
    { title: 'Purchase details', fields: [
      { key: 'projectNumber', label: 'Project number' }, { key: 'poNumber', label: 'PO number' },
      { key: 'committeeNumber', label: 'Committee number' }, { key: 'requestDate', label: 'Request date' },
      { key: 'supplierCode', label: 'Supplier code' }, { key: 'supplierName', label: 'Supplier name' },
      { key: 'taxId', label: 'Tax ID' }, { key: 'representative', label: 'Representative' },
      { key: 'contractNumber', label: 'Contract number' },
      { key: 'recordStatus', label: 'Record status', options: ['✔️', '❌', ''] },
    ] },
    { title: 'Delivery & acceptance', fields: [
      { key: 'deliveryStatus', label: 'Delivery status', options: ['TRUE', 'FALSE', ''] }, { key: 'invoiceNumber', label: 'Invoice number' },
      { key: 'invoiceDate', label: 'Invoice date' }, { key: 'acceptanceDate', label: 'Acceptance date' },
      { key: 'acceptanceStatus', label: 'Acceptance status' }, { key: 'note', label: 'Note', wide: true },
    ] },
  ];
  return <form onSubmit={event => { event.preventDefault(); if (!form.productName.trim()) return; onSave(form); }}>
    {sections.map(section => <section key={section.title} style={{ marginBottom: 20 }}>
      <div className="eyebrow" style={{ marginBottom: 12 }}>{section.title}</div>
      <div className="edit-grid">{section.fields.map(field => <div className={`form-field${field.wide ? ' wide' : ''}`} key={field.key}>
        <label htmlFor={`record-${field.key}`}>{field.label}{field.key === 'productName' ? ' *' : ''}</label>
        {field.key === 'note' ? <textarea id={`record-${field.key}`} value={String(form[field.key] ?? '')} onChange={e => set(field.key, e.target.value)} data-testid={`input-${field.key}`} />
          : field.options ? <select id={`record-${field.key}`} value={String(form[field.key])} onChange={e => set(field.key, e.target.value)} data-testid={`input-${field.key}`}>
             {field.options.map((option, index) => <option key={`${field.key}-${index}`} value={option}>{field.key === 'recordStatus' ? recordStatusLabel(option) : field.key === 'deliveryStatus' ? deliveryStatusLabel(option) : option}</option>)}
          </select>
          : <input id={`record-${field.key}`} type={field.type || 'text'} step={field.type === 'number' ? 'any' : undefined}
            value={String(form[field.key] ?? '')} onChange={e => set(field.key, e.target.value)} data-testid={`input-${field.key}`} />}
      </div>)}</div>
    </section>)}
    <div className="form-footer"><button type="button" className="button button-secondary" onClick={onCancel} data-testid="button-cancel">{'Cancel'}</button>
      <button type="submit" className="button button-primary" disabled={saving || !form.productName.trim()} data-testid="button-save">
        {saving && <LoaderCircle size={14} className="spin" />}{submitLabel}
      </button></div>
  </form>;
}

function CreateDialog({ onClose, onCreated, notify }: { onClose: () => void; onCreated: (id: number) => void; notify: (message: string) => void }) {
  const mutation = useCreatePurchaseRecord();
  const qc = useQueryClient();
  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: getListPurchaseRecordsQueryKey() });
    void qc.invalidateQueries({ queryKey: getGetPurchaseSummaryQueryKey() });
    void qc.invalidateQueries({ queryKey: getGetPurchaseRecordFiltersQueryKey() });
  };
  return <div className="modal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget && !mutation.isPending) onClose(); }}>
    <div className="modal" role="dialog" aria-modal="true" aria-labelledby="create-title">
      <div className="modal-head"><div><div className="eyebrow">New purchase line</div><h2 id="create-title">Add purchase record</h2></div><button className="close-button" onClick={onClose} aria-label="Close" data-testid="button-close-create"><X size={17} /></button></div>
      <div className="modal-body">
        {mutation.isError && <div className="notice" role="alert">Could not save this purchase record. Please review the fields and try again.</div>}
        <RecordForm initial={blankRecord} saving={mutation.isPending} submitLabel="Create record" onCancel={onClose}
          onSave={data => mutation.mutate({ data }, { onSuccess: record => { invalidate(); void qc.invalidateQueries({ queryKey: getGetPurchaseRecordQueryKey(record.id) }); notify('Purchase record created'); onCreated(record.id); }, onError: () => notify('Unable to create record') })} />
      </div>
    </div>
  </div>;
}

function Home() {
  const [, setLocation] = useLocation();
  const [q, setQ] = useState('');
  const [supplierCode, setSupplierCode] = useState('');
  const [recordStatus, setRecordStatus] = useState('');
  const [deliveryState, setDeliveryState] = useState('');
  const [page, setPage] = useState(1);
  const [createOpen, setCreateOpen] = useState(false);
  const { message, notify } = useToastMessage();
  const params = useMemo(() => ({
    ...(q.trim() ? { q: q.trim() } : {}),
    ...(supplierCode ? { supplierCode } : {}),
    ...(recordStatus ? { recordStatus: recordStatus as 'verified' | 'flagged' | 'unmarked' } : {}),
    ...(deliveryState ? { deliveryState: deliveryState as 'delivered' | 'pending' } : {}),
    page, pageSize: 20,
  }), [q, supplierCode, recordStatus, deliveryState, page]);
  const list = useListPurchaseRecords(params);
  const summary = useGetPurchaseSummary();
  const filters = useGetPurchaseRecordFilters();
  const total = list.data?.total ?? 0;
  const maxPage = Math.max(1, Math.ceil(total / (list.data?.pageSize || 20)));
  const clearFilters = () => { setQ(''); setSupplierCode(''); setRecordStatus(''); setDeliveryState(''); setPage(1); };
  const activeFilters = !!(q || supplierCode || recordStatus || deliveryState);
  return <AppShell><main className="page">
    <div className="crumb"><span>Procurement</span><ChevronRight size={13} /><span style={{ color: '#425862' }}>Purchase records</span></div>
    <div className="page-heading"><div><div className="eyebrow">e-GP / Purchase tracking</div><h1>Purchase records</h1><p className="lede">A clear view of each medicine line, from request through acceptance.</p></div>
      <button className="button button-primary" onClick={() => setCreateOpen(true)} data-testid="button-create-record"><Plus size={15} /> Add purchase line</button>
    </div>
    {summary.isError ? <div className="notice" role="alert">Summary totals are temporarily unavailable. <button className="button button-quiet" onClick={() => void summary.refetch()}>Retry</button></div> : null}
    <div className="summary-grid">
      {summary.isLoading ? Array.from({ length: 4 }, (_, i) => <div className="summary-card" key={i}><div className="loading-row" style={{ height: 56, margin: 0 }} /></div>) : <>
        <SummaryCard label="Purchase lines" value={count(summary.data?.totalRecords)} foot="Tracked records" />
        <SummaryCard label="Total value" value={`฿${money(summary.data?.totalValue)}`} foot="Combined line value" gold />
        <SummaryCard label="Delivered" value={count(summary.data?.deliveredRecords)} foot={`${count(summary.data?.pendingDeliveryRecords)} awaiting delivery`} />
        <SummaryCard label="Acceptance" value={count(summary.data?.completedAcceptanceRecords)} foot={`${count(summary.data?.pendingAcceptanceRecords)} awaiting acceptance`} gold />
      </>}
    </div>
    <section>
      <div className="section-head"><div><h2 className="section-title">Purchase register</h2><div className="section-caption">Search and review individual medicine purchase lines</div></div><span className="record-count">{count(total)} records</span></div>
      <div className="list-panel">
        <div className="filterbar">
          <div className="search-wrap"><Search size={15} /><input className="control search-input" type="search" placeholder="Search product, PO, supplier…" value={q}
            onChange={e => { setQ(e.target.value); setPage(1); }} data-testid="input-search-records" /></div>
          <select className="control filter-select" aria-label="Supplier" value={supplierCode} onChange={e => { setSupplierCode(e.target.value); setPage(1); }} data-testid="filter-supplier">
            <option value="">All suppliers</option>{(filters.data?.suppliers || []).map(s => <option key={s.supplierCode} value={s.supplierCode}>{s.supplierName || s.supplierCode}</option>)}
          </select>
          <select className="control filter-select" aria-label="Record review status" value={recordStatus} onChange={e => { setRecordStatus(e.target.value); setPage(1); }} data-testid="filter-record-status">
            <option value="">All review states</option><option value="verified">Verified</option><option value="flagged">Flagged</option><option value="unmarked">Unmarked</option>
          </select>
          <select className="control filter-select" aria-label="Delivery status" value={deliveryState} onChange={e => { setDeliveryState(e.target.value); setPage(1); }} data-testid="filter-delivery">
            <option value="">All deliveries</option><option value="delivered">Delivered</option><option value="pending">Pending</option>
          </select>
          {activeFilters && <button className="button button-quiet" style={{ padding: '8px 10px' }} onClick={clearFilters} data-testid="button-clear-filters">Clear</button>}
        </div>
        {list.isLoading ? <LoadingBlock /> : list.isError ? <div className="error-state" role="alert"><div className="empty-icon"><FileText size={20} /></div><h3>Records could not be loaded</h3><p>Check the connection and try again.</p><button className="button button-secondary" onClick={() => void list.refetch()} data-testid="button-retry-list">Retry</button></div>
          : !list.data?.items?.length ? <div className="empty-state"><div className="empty-icon"><FilePlus2 size={20} /></div><h3>{activeFilters ? 'No matching purchase lines' : 'No purchase records yet'}</h3>
            <p>{activeFilters ? 'Try another search or clear the selected filters.' : 'Add a medicine purchase line to begin tracking.'}</p>
            {activeFilters ? <button className="button button-secondary" onClick={clearFilters} data-testid="button-empty-clear">Clear filters</button> : <button className="button button-primary" onClick={() => setCreateOpen(true)} data-testid="button-empty-create"><Plus size={14} /> Add purchase line</button>}
          </div>
          : <div className="table-scroll"><table className="records-table"><thead><tr><th>Medicine / product</th><th>Purchase order</th><th>Supplier</th><th>Request date</th><th>Quantity</th><th>Line total</th><th>Record</th><th>Delivery</th><th aria-label="Open record" /></tr></thead>
            <tbody>{list.data.items.map(record => <tr key={record.id} onClick={() => setLocation(`/records/${record.id}`)} data-testid={`row-record-${record.id}`}>
              <td><div className="product-name">{record.productName || 'Unnamed medicine'}</div><div className="subline">{record.companyDrugKey || record.projectNumber || '—'}</div></td>
              <td><div className="mono">{record.poNumber || '—'}</div><div className="subline">{record.committeeNumber || ''}</div></td>
              <td><div className="product-name" style={{ fontSize: 11, fontWeight: 600 }}>{record.supplierName || '—'}</div><div className="subline">{record.supplierCode || ''}</div></td>
              <td className="mono">{record.requestDate || '—'}</td>
              <td><span className="money">{record.quantity == null ? '—' : count(record.quantity)}</span><span className="subline">{record.unit || ''}</span></td>
              <td className="money">{record.lineTotal == null ? '—' : `฿${money(record.lineTotal)}`}</td>
               <td><span className={`status-pill ${statusClass(record.recordStatus)}`}>{recordStatusLabel(record.recordStatus)}</span></td>
               <td><span className={`status-pill ${statusClass(record.deliveryStatus, 'delivery')}`}>{deliveryStatusLabel(record.deliveryStatus)}</span></td>
              <td><ArrowRight size={15} className="row-arrow" /></td>
            </tr>)}</tbody></table></div>}
        {!list.isLoading && !list.isError && list.data?.items?.length ? <div className="pagination"><span>Showing {((page - 1) * (list.data.pageSize || 20)) + 1}–{Math.min(page * (list.data.pageSize || 20), total)} of {count(total)}</span>
          <div className="page-actions"><button className="page-action" disabled={page <= 1} aria-label="Previous page" onClick={() => setPage(p => Math.max(1, p - 1))} data-testid="button-page-previous"><ChevronLeft size={15} /></button>
            <span style={{ padding: '8px 5px' }}>Page {page} of {maxPage}</span>
            <button className="page-action" disabled={page >= maxPage} aria-label="Next page" onClick={() => setPage(p => Math.min(maxPage, p + 1))} data-testid="button-page-next"><ChevronRight size={15} /></button></div></div> : null}
      </div>
    </section>
    <footer style={{ display: 'flex', justifyContent: 'space-between', marginTop: 20, color: '#8b9698', fontSize: 10 }}><span>{count(summary.data?.supplierCount)} suppliers on file</span><span>Hospital procurement · e-GP register</span></footer>
    {createOpen && <CreateDialog onClose={() => setCreateOpen(false)} notify={notify} onCreated={id => { setCreateOpen(false); setLocation(`/records/${id}`); }} />}
    <Toast message={message} />
  </main></AppShell>;
}

function inputFromRecord(r: PurchaseRecord): PurchaseRecordInput {
  return {
    projectNumber: r.projectNumber || '', poNumber: r.poNumber || '', committeeNumber: r.committeeNumber || '',
    requestDate: r.requestDate || '', supplierCode: r.supplierCode || '', supplierName: r.supplierName || '',
    taxId: r.taxId || '', recordStatus: r.recordStatus.trim() ? r.recordStatus : '', productName: r.productName || '',
    companyDrugKey: r.companyDrugKey || '', quantity: r.quantity, unit: r.unit || '', unitPrice: r.unitPrice,
    lineTotal: r.lineTotal, gpu: r.gpu || '', tpu: r.tpu || '', representative: r.representative || '',
    contractNumber: r.contractNumber || '', deliveryStatus: r.deliveryStatus || 'FALSE', note: r.note || '',
    invoiceDate: r.invoiceDate || '', acceptanceDate: r.acceptanceDate || '',
    invoiceNumber: r.invoiceNumber || '', acceptanceStatus: r.acceptanceStatus || '',
  };
}

function DetailPage() {
  const params = useParams<{ id: string }>();
  const id = Number(params.id);
  const [, setLocation] = useLocation();
  const qc = useQueryClient();
  const recordQuery = useGetPurchaseRecord(id, { query: { queryKey: getGetPurchaseRecordQueryKey(id), enabled: Number.isFinite(id) && id > 0 } });
  const update = useUpdatePurchaseRecord();
  const remove = useDeletePurchaseRecord();
  const [editing, setEditing] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [toast, setToast] = useState('');
  const notify = (s: string) => { setToast(s); window.setTimeout(() => setToast(''), 3200); };
  const record = recordQuery.data;
  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: getListPurchaseRecordsQueryKey() });
    void qc.invalidateQueries({ queryKey: getGetPurchaseRecordQueryKey(id) });
    void qc.invalidateQueries({ queryKey: getGetPurchaseSummaryQueryKey() });
    void qc.invalidateQueries({ queryKey: getGetPurchaseRecordFiltersQueryKey() });
  };
  if (!Number.isFinite(id) || id < 1) return <AppShell><main className="page"><div className="error-state"><h3>Invalid purchase record</h3><Link href="/" className="button button-secondary">Back to register</Link></div></main></AppShell>;
  return <AppShell><main className="page">
    <Link href="/" className="back-link" data-testid="link-back-register"><ArrowLeft size={14} /> Back to purchase register</Link>
    {recordQuery.isLoading ? <div className="detail-card"><div className="detail-card-body"><LoadingBlock /></div></div>
      : recordQuery.isError || !record ? <div className="error-state"><div className="empty-icon"><FileText size={20} /></div><h3>Purchase record unavailable</h3><p>This line may have been removed or the connection is unavailable.</p><button className="button button-secondary" onClick={() => void recordQuery.refetch()} data-testid="button-retry-detail">Retry</button></div>
        : <>
          <div className="detail-top"><div><div className="eyebrow">Purchase record · #{record.id}</div><h1>{record.productName || 'Unnamed medicine'}</h1><p className="lede">{record.supplierName || 'Supplier not specified'} <span style={{ margin: '0 7px', color: '#b1bab8' }}>·</span><span className="mono">{record.poNumber || 'No PO number'}</span></p></div>
            <div className="detail-actions"><button className="button button-secondary" onClick={() => setEditing(v => !v)} data-testid="button-edit-record">{editing ? <X size={14} /> : <Pencil size={14} />}{editing ? 'Cancel edit' : 'Edit record'}</button>
              <button className="button button-danger" onClick={() => setConfirmingDelete(true)} data-testid="button-delete-record"><Trash2 size={14} /> Delete</button></div>
          </div>
          <div className="detail-grid">
            <div>
              {editing ? <div className="detail-card"><div className="detail-card-head"><h2>Edit purchase line</h2><span className="record-count">Changes not saved</span></div><div className="detail-card-body">
                {update.isError && <div className="notice" role="alert">Could not save changes. Please try again.</div>}
                <RecordForm key={`${record.id}-${record.updatedAt}`} initial={inputFromRecord(record)} saving={update.isPending} submitLabel="Save changes" onCancel={() => setEditing(false)}
                  onSave={data => update.mutate({ id, data: data as PurchaseRecordUpdate }, { onSuccess: () => { invalidate(); setEditing(false); notify('Purchase record updated'); }, onError: () => notify('Unable to save changes') })} />
              </div></div> : <>
                <div className="detail-card"><div className="detail-card-head"><h2>Medicine & pricing</h2><span className="status-pill neutral">{record.unit || 'Purchase line'}</span></div><div className="detail-card-body"><div className="field-grid">
                  <Field label="Product name" value={record.productName} /><Field label="Company drug key" value={record.companyDrugKey} mono />
                  <Field label="Quantity" value={record.quantity == null ? '' : `${count(record.quantity)} ${record.unit || ''}`} /><Field label="Unit price" value={record.unitPrice == null ? '' : `฿${money(record.unitPrice)}`} />
                  <Field label="Line total" value={record.lineTotal == null ? '' : `฿${money(record.lineTotal)}`} /><Field label="GPU / TPU" value={[record.gpu, record.tpu].filter(Boolean).join(' / ')} />
                  <Field label="Note" value={record.note} />
                </div></div></div>
                <div className="detail-card"><div className="detail-card-head"><h2>Purchase details</h2><span className={`status-pill ${statusClass(record.recordStatus)}`}>{recordStatusLabel(record.recordStatus)}</span></div><div className="detail-card-body"><div className="field-grid">
                  <Field label="Project number" value={record.projectNumber} mono /><Field label="PO number" value={record.poNumber} mono />
                  <Field label="Committee number" value={record.committeeNumber} mono /><Field label="Request date" value={record.requestDate} mono />
                  <Field label="Supplier" value={record.supplierName} /><Field label="Supplier code" value={record.supplierCode} mono />
                  <Field label="Tax ID" value={record.taxId} mono /><Field label="Representative" value={record.representative} />
                  <Field label="Contract number" value={record.contractNumber} mono /><Field label="Source sheet row" value={record.sourceSheetRow ?? ''} mono />
                </div></div></div>
              </>}
            </div>
            {!editing && <aside>
              <div className="detail-card"><div className="detail-card-head"><h2>Receiving & acceptance</h2><PackageCheck size={16} color="#638579" /></div><div className="detail-card-body">
                <div className="workflow">
                  <div className={`workflow-item ${statusClass(record.deliveryStatus, 'delivery') === '' ? 'done' : ''}`}><span className="workflow-dot" /><div className="workflow-title">Delivery</div><div className="workflow-date">{deliveryStatusLabel(record.deliveryStatus)}</div></div>
                  <div className={`workflow-item ${statusClass(record.acceptanceStatus, 'acceptance') === '' ? 'done' : ''}`}><span className="workflow-dot" /><div className="workflow-title">Acceptance</div><div className="workflow-date">{record.acceptanceStatus || 'Pending'}</div></div>
                </div>
                <div className="field-grid" style={{ borderTop: '1px solid #edf0eb', paddingTop: 15 }}>
                  <Field label="Invoice number" value={record.invoiceNumber} mono /><Field label="Invoice date" value={record.invoiceDate} mono />
                  <Field label="Acceptance date" value={record.acceptanceDate} mono />
                </div>
              </div></div>
              <div className="detail-card"><div className="detail-card-head"><h2>Record history</h2><ShieldCheck size={16} color="#638579" /></div><div className="detail-card-body">
                <div className="field-grid"><Field label="Created" value={record.createdAt} mono /><Field label="Last updated" value={record.updatedAt} mono /></div>
              </div></div>
              <div className="notice">Dates are shown as provided in the source record.</div>
            </aside>}
          </div>
        </>}
    {confirmingDelete && record && <div className="modal-backdrop"><div className="modal confirm-modal" role="alertdialog" aria-modal="true" aria-labelledby="delete-title">
      <div className="confirm-mark"><Trash2 size={19} /></div><h2 id="delete-title">Delete this purchase line?</h2><p><strong>{record.productName}</strong> and its purchase details will be permanently removed. This action cannot be undone.</p>
      {remove.isError && <div className="notice" role="alert">Deletion failed. Please try again.</div>}
      <div className="form-footer" style={{ marginTop: 0, paddingTop: 0, border: 0 }}><button className="button button-secondary" onClick={() => setConfirmingDelete(false)} disabled={remove.isPending} data-testid="button-cancel-delete">Keep record</button>
        <button className="button button-danger" onClick={() => remove.mutate({ id }, { onSuccess: () => { invalidate(); notify('Purchase record deleted'); setConfirmingDelete(false); setLocation('/'); }, onError: () => notify('Unable to delete record') })} disabled={remove.isPending} data-testid="button-confirm-delete">{remove.isPending && <LoaderCircle size={14} /> }Delete record</button></div>
    </div></div>}
    <Toast message={toast} />
  </main></AppShell>;
}

function Router() {
  return <RoutedErrorBoundary><Switch>
    <Route path="/" component={Home} />
    <Route path="/records/:id" component={DetailPage} />
    <Route component={NotFound} />
  </Switch></RoutedErrorBoundary>;
}
function RoutedErrorBoundary({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  return <ErrorBoundary resetKey={location}>{children}</ErrorBoundary>;
}
function App() {
  return <QueryClientProvider client={queryClient}><TooltipProvider><WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}><Router /></WouterRouter><Toaster /></TooltipProvider></QueryClientProvider>;
}
export default App;