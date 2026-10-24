import { useQuery } from '@tanstack/react-query';
import { Search } from 'lucide-react';
import { Link, useSearchParams } from 'react-router';
import { STATUS_TONE, displayStatus } from '../components/InvoiceTable';
import { Alert, Badge, Card, CardHeader, EmptyState, PageHeader, Skeleton } from '../components/ui';
import { errorMessage, searchAll, todayIn } from '../lib/api';
import { useSupabase } from '../lib/auth';
import { money } from '../lib/format';
import { useActiveOrg } from '../lib/org';

export function SearchPage() {
  const sb = useSupabase();
  const { org } = useActiveOrg();
  const [params] = useSearchParams();
  const q = params.get('q') ?? '';
  const today = todayIn(org.timezone);
  const results = useQuery({
    queryKey: ['search', org.id, q],
    queryFn: () => searchAll(sb, org.id, q),
    enabled: q.trim().length > 0,
  });

  return (
    <>
      <PageHeader
        title="Search"
        description={q ? `Results for “${q}”` : 'Search invoices and clients from the bar above.'}
      />
      {!q.trim() ? (
        <Card>
          <EmptyState icon={<Search className="h-5 w-5" />} title="Type to search">
            Invoice numbers, client names, companies and email addresses.
          </EmptyState>
        </Card>
      ) : results.isPending ? (
        <Skeleton className="h-48" />
      ) : results.error ? (
        <Alert tone="danger">{errorMessage(results.error)}</Alert>
      ) : results.data.invoices.length + results.data.clients.length === 0 ? (
        <Card>
          <EmptyState icon={<Search className="h-5 w-5" />} title="Nothing found">
            Try a shorter or different search.
          </EmptyState>
        </Card>
      ) : (
        <div className="grid gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader title="Clients" />
            {results.data.clients.length === 0 ? (
              <p className="px-5 py-4 text-sm text-graphite">No matching clients.</p>
            ) : (
              <ul className="divide-y divide-rule">
                {results.data.clients.map((c) => (
                  <li key={c.id}>
                    <Link
                      to={`/clients/${c.id}`}
                      className="block px-5 py-3 text-sm hover:bg-hover"
                    >
                      <span className="font-semibold">{c.company || c.name}</span>
                      <span className="block text-xs text-graphite">
                        {[c.company && c.name, c.email].filter(Boolean).join(' · ')}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <Card>
            <CardHeader title="Documents" />
            {results.data.invoices.length === 0 ? (
              <p className="px-5 py-4 text-sm text-graphite">No matching documents.</p>
            ) : (
              <ul className="divide-y divide-rule">
                {results.data.invoices.map((r) => {
                  const status = displayStatus(r, today);
                  return (
                    <li key={r.id}>
                      <Link
                        to={`/invoices/${r.id}`}
                        className="flex items-center gap-3 px-5 py-3 text-sm hover:bg-hover"
                      >
                        <span className="min-w-0 flex-1">
                          <span className="font-semibold">{r.number || 'Untitled'}</span>
                          <span className="block truncate text-xs text-graphite">
                            {r.client_name || 'No client'}
                          </span>
                        </span>
                        <Badge tone={STATUS_TONE[status] ?? 'neutral'}>{status}</Badge>
                        <span className="tabular-nums">{money(r.total_minor, r.currency)}</span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>
        </div>
      )}
    </>
  );
}
