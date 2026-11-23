import { Suspense } from 'react';
import { CardDetailScreen } from '../../../../../features/vocabulary/index.ts';

// The details of one card. The card ID is known only when the page is requested, so the screen
// waits for it behind a Suspense boundary and the rest of the page is prerendered.
export default function CardPage({ params }: { params: Promise<{ id: string }> }) {
  return (
    <Suspense fallback={null}>
      {params.then(({ id }) => (
        <CardDetailScreen key={id} cardId={id} />
      ))}
    </Suspense>
  );
}
