/**
 * Accepting a team invitation. The token travels in the URL fragment
 * (#token=…) so it never reaches server logs or Referer headers, and is held
 * in sessionStorage while the person signs in or registers.
 */
import { useMutation } from '@tanstack/react-query';
import { Users } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { Logo } from '../components/AppShell';
import { Alert, Button, Card } from '../components/ui';
import { acceptInvitation, errorMessage } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useOrgs } from '../lib/org';

const KEY = 'sasu:inviteToken';

function readToken(): string | null {
  const fromHash = new URLSearchParams(location.hash.slice(1)).get('token');
  try {
    if (fromHash) {
      sessionStorage.setItem(KEY, fromHash);
      history.replaceState(null, '', location.pathname);
    }
    return fromHash ?? sessionStorage.getItem(KEY);
  } catch {
    return fromHash;
  }
}

export function InvitePage() {
  const { sb, session, user } = useAuth();
  const { refetch, select } = useOrgs();
  const navigate = useNavigate();
  const [token] = useState(readToken);
  const accept = useMutation({
    mutationFn: () => acceptInvitation(sb, token!),
    onSuccess: async (orgId) => {
      try {
        sessionStorage.removeItem(KEY);
      } catch {
        /* ignore */
      }
      await refetch();
      select(orgId);
      navigate('/', { replace: true });
    },
  });

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center px-4">
      <div className="mb-8">
        <Logo />
      </div>
      <Card className="w-full max-w-sm p-6 text-center">
        <Users className="mx-auto h-9 w-9 text-brand" aria-hidden />
        <h1 className="mt-3 font-display text-xl font-bold">Join your team</h1>
        {!token ? (
          <Alert tone="warn" className="mt-4 text-left">
            This invitation link is incomplete. Ask for a new invitation.
          </Alert>
        ) : !session ? (
          <>
            <p className="mt-2 text-sm text-graphite">
              Sign in or create an account with the email address the invitation was sent to.
            </p>
            <div className="mt-5 flex flex-col gap-2">
              <Link
                to="/login?next=/invite"
                className="rounded-lg bg-brand py-2.5 text-sm font-semibold text-white"
              >
                Sign in
              </Link>
              <Link
                to="/register?next=/invite"
                className="rounded-lg border border-field py-2.5 text-sm font-semibold"
              >
                Create an account
              </Link>
            </div>
          </>
        ) : (
          <>
            <p className="mt-2 text-sm text-graphite">
              You’re signed in as <strong className="text-ink">{user?.email}</strong>.
            </p>
            {accept.error && (
              <Alert tone="danger" className="mt-4 text-left">
                {errorMessage(accept.error)}
              </Alert>
            )}
            <Button
              className="mt-5 w-full"
              loading={accept.isPending}
              onClick={() => accept.mutate()}
            >
              Accept invitation
            </Button>
          </>
        )}
      </Card>
    </div>
  );
}
