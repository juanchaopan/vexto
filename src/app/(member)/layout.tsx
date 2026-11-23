import type { ReactNode } from 'react';
import { MemberGate } from '../../features/account/index.ts';

// Every page in this group needs an active member who accepted the current terms.
export default function MemberLayout({ children }: { children: ReactNode }) {
  return <MemberGate>{children}</MemberGate>;
}
