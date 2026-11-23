// Reviews: Spell and Translate questions of a member's vocabulary, judging the answers and moving
// each mode's round and due time on, and the review counts. Web only. The cards and their
// progress belong to the vocabulary, which this feature reads and writes through the vocabulary's
// index; the vocabulary never imports reviews. Import this index from server components and
// route handlers only.
export { nextQuestionResult, reviewCountsResult, submitAnswerResult } from './server/review-api.ts';
export { submitRequest } from './server/review-request.ts';
