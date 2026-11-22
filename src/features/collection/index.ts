/**
 * One run of the collection pipeline (.docs/design/rules.md), which the vexto-collect job starts
 * every 15 minutes. The pipeline's steps are not built yet, so a run has nothing to collect and
 * returns at once.
 */
export async function runCollection(): Promise<void> {}
