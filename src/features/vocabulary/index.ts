// The vocabulary: each member's cards with their examples, Translate options and review progress,
// the vocabulary endpoints, and the Vocabulary screen, card details and the saver of
// explanations in the interface. Web only. Import it from server components, route handlers and
// the server layer of other features; client components of other features reach it only through
// src/lib/ui.
export {
  FINAL_ROUND,
  REVIEW_MODES,
  type CardProgress,
  type ModeProgress,
  type ReviewMode,
} from './domain/review-progress.ts';
export { TRANSLATION_OPTION_COUNT, type TranslationOption } from './domain/translation-set.ts';
export { cardSources } from './server/card-sources.ts';
export {
  cardExamples,
  readCard,
  type CardExampleView,
  type CardView,
} from './server/card-store.ts';
export {
  bulkDeleteResult,
  cardResult,
  deleteCardResult,
  refreshCardExampleResult,
  replaceCardResult,
  saveCardResult,
  vocabularyListResult,
  type VocabularyDependencies,
} from './server/vocabulary-api.ts';
export {
  bulkDeleteRequest,
  cardExamplePath,
  cardPathId,
  operationRequest,
  replaceRequest,
  saveRequest,
} from './server/vocabulary-request.ts';
export {
  reviewProgress,
  translationSets,
  vocabularyCards,
  vocabularyExamples,
} from './server/schema.ts';
