// The no access page (.docs/design/screens.md, 没有资格): shown to a signed-in Google account that
// is not an active member, including a member who was revoked.
import { Button } from '../../../lib/ui/button.tsx';
import { Icon } from '../../../lib/ui/icon.tsx';
import { CenteredBody, DocPage } from './doc-page.tsx';

export type NoAccessProps = {
  /** The signed-in account's email address; empty while Clerk is still loading it. */
  email: string;
  onLogOut: () => void;
  loggingOut?: boolean;
};

export function NoAccess({ email, onLogOut, loggingOut = false }: NoAccessProps) {
  return (
    <DocPage>
      <CenteredBody>
        <h1>No access</h1>
        <p>{email} isn&apos;t on the vexto invitation list.</p>
        <p>
          Ask the person who runs vexto to invite this Google account, or log out and use another
          account.
        </p>
        <Button onClick={onLogOut} disabled={loggingOut}>
          <Icon name={loggingOut ? 'loader-circle' : 'log-out'} spin={loggingOut} />
          Log out
        </Button>
      </CenteredBody>
    </DocPage>
  );
}
