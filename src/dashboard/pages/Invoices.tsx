import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FileText, PenLine, Search } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router';
import { InvoiceTable } from '../components/InvoiceTable';
import {
  Alert,
  Button,
  Card,
  ConfirmDialog,
  EmptyState,
  Input,
  PageHeader,
  Select,
  Skeleton,
  buttonVariants,
} from '../components/ui';
import {
  INVOICE_PAGE_SIZE,
  deleteDraft,
  errorMessage,
  listInvoices,
  type CloudInvoiceRow,
  INVOICE_SORTS,
  PAYMENT_FILTERS,
  todayIn,
  type InvoiceSort,
  type PaymentFilter,
} from '../lib/api';
import { useSupabase } from '../lib/auth';
import { useActiveOrg } from '../lib/org';
import { useToast } from '../lib/toast';

const TYPES = [
  { value: '', label: 'All documents' },
  { value: 'invoice', label: 'Invoices' },
  { value: 'quote', label: 'Quotes' },
  { value: 'credit', label: 'Credit notes' },
  { value: 'receipt', label: 'Receipts' },
  { value: 'proforma', label: 'Proformas' },
];

export function InvoicesPage() {
  const sb = useSupabase();
  const { org } = useActiveOrg();
  const toast = useToast();
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();
  const page = Math.max(0, Number(params.get('page')) || 0);
  const docType = TYPES.some((t) => t.value === params.get('type'))
    ? (params.get('type') ?? '')
    : '';
  const [search, setSearch] = useState(params.get('q') ?? '');
  const [deleting, setDeleting] = useState<CloudInvoiceRow | null>(null);

  // Debounce typing into the URL (which drives the query).
  useEffect(() => {
    const t = setTimeout(() => {
      setParams(
        (p) => {
          if ((p.get('q') ?? '') === search) return p;
          const next = new URLSearchParams(p);
          if (search) next.set('q', search);
          else next.delete('q');
          next.delete('page');
          return next;
        },
        { replace: true },
      );
    }, 300);
    return () => clearTimeout(t);
  }, [search, setParams]);

  const filter = (PAYMENT_FILTERS as readonly string[]).includes(params.get('filter') ?? '')
    ? (params.get('filter') as PaymentFilter)
    : '';
  const sort = (INVOICE_SORTS as readonly string[]).includes(params.get('sort') ?? '')
    ? (params.get('sort') as InvoiceSort)
    : 'updated';
  const opts = {
    page,
    search: params.get('q') ?? '',
    docType,
    filter,
    sort,
    today: todayIn(org.timezone),
  };
  const list = useQuery({
    queryKey: ['invoices', org.id, opts],
    queryFn: () => listInvoices(sb, org.id, opts),
    placeholderData: keepPreviousData,
  });

  const remove = useMutation({
    mutationFn: (row: CloudInvoiceRow) => deleteDraft(sb, row.id),
    onSuccess: (_d, row) => {
      toast(`Draft ${row.number} deleted from the cloud`);
      setDeleting(null);
      void qc.invalidateQueries({ queryKey: ['invoices', org.id] });
    },
    onError: (err) => toast(errorMessage(err), 'error'),
  });

  const setParam = (key: string, value: string) =>
    setParams((p) => {
      const next = new URLSearchParams(p);
      if (value) next.set(key, value);
      else next.delete(key);
      if (key !== 'page') next.delete('page');
      return next;
    });

  const total = list.data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / INVOICE_PAGE_SIZE));

  return (
    <>
      <PageHeader
        title="Invoices"
        description="Documents saved to the cloud for this organization."
        actions={
          <a href="/app.html" className={buttonVariants()}>
            <PenLine className="h-4 w-4" aria-hidden /> New invoice
          </a>
        }
      />
      <Card>
        <div className="flex flex-wrap gap-3 border-b border-rule p-4">
          <div className="relative min-w-56 flex-1">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-faint"
              aria-hidden
            />
            <Input
              type="search"
              aria-label="Search by number or client"
              placeholder="Search by number or client"
              className="pl-9"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <Select
            aria-label="Document type"
            className="w-auto"
            value={docType}
            onChange={(e) => setParam('type', e.target.value)}
          >
            {TYPES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </Select>
          <Select
            aria-label="Payment status"
            className="w-auto"
            value={filter}
            onChange={(e) => setParam('filter', e.target.value)}
          >
            <option value="">Any status</option>
            <option value="draft">Drafts</option>
            <option value="open">Unpaid (open)</option>
            <option value="partial">Partially paid</option>
            <option value="overdue">Overdue</option>
            <option value="paid">Paid</option>
          </Select>
          <Select
            aria-label="Sort by"
            className="w-auto"
            value={sort}
            onChange={(e) => setParam('sort', e.target.value === 'updated' ? '' : e.target.value)}
          >
            <option value="updated">Recently updated</option>
            <option value="due">Due date</option>
            <option value="issued">Issue date</option>
            <option value="amount">Amount</option>
          </Select>
        </div>

        {list.isPending ? (
          <div className="space-y-2 p-5">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-11" />
            ))}
          </div>
        ) : list.error ? (
          <div className="p-5">
            <Alert tone="danger">{errorMessage(list.error)}</Alert>
            <Button variant="secondary" className="mt-3" onClick={() => void list.refetch()}>
              Try again
            </Button>
          </div>
        ) : list.data.rows.length === 0 ? (
          <EmptyState
            icon={<FileText className="h-5 w-5" />}
            title={
              opts.search || docType || filter ? 'No matching documents' : 'No cloud documents yet'
            }
          >
            {opts.search || docType || filter
              ? 'Try a different search or filter.'
              : 'Create an invoice in the editor with cloud saving on, or import the ones in this browser.'}
          </EmptyState>
        ) : (
          <>
            <InvoiceTable orgId={org.id} rows={list.data.rows} onDelete={setDeleting} />
            <div className="flex items-center justify-between border-t border-rule px-5 py-3 text-sm text-graphite">
              <span>
                {page * INVOICE_PAGE_SIZE + 1}–{Math.min(total, (page + 1) * INVOICE_PAGE_SIZE)} of{' '}
                {total}
              </span>
              <div className="flex gap-2">
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={page === 0}
                  onClick={() => setParam('page', String(page - 1))}
                >
                  Previous
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={page + 1 >= pages}
                  onClick={() => setParam('page', String(page + 1))}
                >
                  Next
                </Button>
              </div>
            </div>
          </>
        )}
      </Card>

      <ConfirmDialog
        open={!!deleting}
        title={`Delete draft ${deleting?.number ?? ''}?`}
        confirmLabel="Delete draft"
        tone="danger"
        loading={remove.isPending}
        onCancel={() => setDeleting(null)}
        onConfirm={() => deleting && remove.mutate(deleting)}
      >
        The draft is removed from the cloud. Copies saved in a browser are not affected. Issued
        documents can’t be deleted.
      </ConfirmDialog>
    </>
  );
}
