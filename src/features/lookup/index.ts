// Looking up words: the lookup endpoints, the AI tasks and the lookup tables. Web only: the Cloud
// Run entries never import this feature. Import it from route handlers and the server layer of
// other features.
export {
  acceptedFormsWith,
  exampleOf,
  exampleProblems,
  findTargetRanges,
  type Example,
} from './domain/explanation.ts';
export {
  lemmaKey,
  MEANING_MAX_LENGTH,
  PARTS_OF_SPEECH,
  type PartOfSpeech,
  type TargetRange,
} from './domain/lookup-entry.ts';
export {
  lookupResult,
  refreshExampleResult,
  type LookupDependencies,
  type RequestMember,
} from './server/lookup-api.ts';
export { lookupExample, type CardSources, type ExampleText } from './server/lookup-context.ts';
export { lookupRequest, refreshExampleRequest, refreshPath } from './server/lookup-request.ts';
export {
  modelServices,
  runModelTask,
  type JsonSchema,
  type ModelServices,
  type ModelTask,
  type TaskVerdict,
} from './server/model-call.ts';
export {
  exampleChecks,
  exampleColumns,
  examples,
  lookupEntries,
  meaningChecks,
  meaningColumns,
} from './server/schema.ts';
