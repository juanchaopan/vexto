import { Suspense } from 'react';
import { ReaderScreen } from '../../../../../features/reading/index.ts';

// The reader of one article. The article ID is known only when the page is requested, so the
// screen waits for it behind a Suspense boundary and the rest of the page is prerendered.
export default function ReaderPage({ params }: { params: Promise<{ id: string }> }) {
  return (
    <Suspense fallback={null}>
      {params.then(({ id }) => (
        <ReaderScreen key={id} articleId={id} />
      ))}
    </Suspense>
  );
}
