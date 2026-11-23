// Looking up words: the lookup endpoints, the AI tasks, the lookup tables and the explanations in
// the interface. Web only: the Cloud Run entries never import this feature. Import it from server
// components, route handlers and the server layer of other features; client components of other
// features reach lookups through the lookup bridge of src/lib/ui.
export {
  acceptedFormsWith,
  exampleOf,
  exampleProblems,
  findTargetRanges,
  meaningProblems,
  type Example,
} from './domain/explanation.ts';
export { spellHiddenRanges } from './domain/hidden-target.ts';
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
export { exampleTask } from './server/explanation-tasks.ts';
export { lookupExample, type CardSources, type ExampleText } from './server/lookup-context.ts';
export { lookupRequest, refreshExampleRequest, refreshPath } from './server/lookup-request.ts';
export {
  DATA_RULE,
  modelServices,
  runModelTask,
  SHAPE_PROBLEM,
  strictObject,
  verdict,
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
export { LookupHost } from './ui/lookup-host.tsx';
