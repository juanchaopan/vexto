// Dependency rules of the code structure in .docs/architecture.md:
//   src/app       routes and page entries of the web application
//   src/worker    entries of the Cloud Run job and services
//   src/features  one module per feature, layered into domain, server and ui, public through index.ts
//   src/lib       shared code such as the database connection and environment reading
// Dependencies point app -> features -> lib and worker -> features -> lib.
// Tests are left out of the graph: they may reach into the code they test.

// Server-only packages that must never end up in code shipped to the browser.
const serverSdks = [
  'node_modules/server-only/',
  'node_modules/drizzle-orm/',
  'node_modules/postgres/',
  'node_modules/openai/',
  'node_modules/@aws-sdk/',
  'node_modules/google-auth-library/',
  'node_modules/@clerk/nextjs/dist/[^/]+/server/',
  'node_modules/next/(server|headers)(\\.js)?$',
];

// Packages only the collection job and the speech service use; reaching them from a web
// application entry would put them into the Vercel function bundle.
const workerOnlyPackages = [
  'node_modules/jsdom/',
  'node_modules/@mozilla/readability/',
  'node_modules/onnxruntime-node/',
];

/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: 'no-circular',
      severity: 'error',
      comment: 'Modules must not depend on each other in a cycle.',
      from: {},
      to: { circular: true },
    },
    {
      name: 'not-to-unresolvable',
      severity: 'error',
      comment: 'Every import must resolve to a file or an installed package.',
      from: {},
      to: { couldNotResolve: true },
    },
    {
      name: 'lib-stays-shared',
      severity: 'error',
      comment: 'lib is shared by everything above it and must not reach back up.',
      from: { path: '^src/lib/' },
      to: { path: '^src/(features|app|worker)/' },
    },
    {
      name: 'features-not-to-entries',
      severity: 'error',
      comment: 'Features must not import the web application or Cloud Run entries.',
      from: { path: '^src/features/' },
      to: { path: '^src/(app|worker)/' },
    },
    {
      name: 'app-not-to-worker',
      severity: 'error',
      comment: 'The web application and the Cloud Run entries do not import each other.',
      from: { path: '^src/app/' },
      to: { path: '^src/worker/' },
    },
    {
      name: 'worker-not-to-app',
      severity: 'error',
      comment: 'The web application and the Cloud Run entries do not import each other.',
      from: { path: '^src/worker/' },
      to: { path: '^src/app/' },
    },
    {
      name: 'entries-use-feature-index',
      severity: 'error',
      comment: 'Route and Cloud Run entries use a feature only through its index.ts.',
      from: { path: '^src/(app|worker)/' },
      to: { path: '^src/features/[^/]+/', pathNot: '^src/features/[^/]+/index\\.ts$' },
    },
    {
      name: 'app-not-to-worker-only-packages',
      severity: 'error',
      comment:
        'jsdom, @mozilla/readability and onnxruntime-node run only in Cloud Run and must not be reachable from the web application.',
      from: { path: '^src/app/' },
      to: { path: workerOnlyPackages, reachable: true },
    },
    {
      name: 'cross-feature-through-index',
      severity: 'error',
      comment: 'A feature uses another feature only through that feature’s index.ts.',
      from: { path: '^src/features/([^/]+)/' },
      to: {
        path: '^src/features/[^/]+/',
        pathNot: ['^src/features/$1/', '^src/features/[^/]+/index\\.ts$'],
      },
    },
    {
      name: 'domain-is-pure',
      severity: 'error',
      comment:
        'domain holds pure business rules: it depends only on its own domain code, not on server, ui, lib, frameworks, SDKs or Node built-ins.',
      from: { path: '^src/features/([^/]+)/domain/' },
      to: { pathNot: '^src/features/$1/domain/' },
    },
    {
      name: 'ui-not-to-server',
      severity: 'error',
      comment: 'Components run in the browser and must not import the server layer.',
      from: { path: '^src/features/[^/]+/ui/' },
      to: { path: '^src/features/[^/]+/server/' },
    },
    {
      name: 'browser-not-to-server-sdks',
      severity: 'error',
      comment: 'Browser code must not import server SDKs.',
      from: { path: '^src/features/[^/]+/ui/' },
      to: { path: [...serverSdks, ...workerOnlyPackages] },
    },
    {
      name: 'browser-not-to-node-builtins',
      severity: 'error',
      comment: 'Browser code must not import Node built-ins.',
      from: { path: '^src/features/[^/]+/ui/' },
      to: { dependencyTypes: ['core'] },
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    exclude: { path: '\\.test\\.tsx?$' },
    tsPreCompilationDeps: true,
    tsConfig: { fileName: 'tsconfig.json' },
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['import', 'require', 'node', 'default', 'types'],
      mainFields: ['module', 'main', 'types', 'typings'],
    },
  },
};
