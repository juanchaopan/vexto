// Commit message format: Conventional Commits with the config-conventional types and a first line
// of at most 100 characters. Trailers such as Step, Co-Authored-By and Claude-Session are free
// footer lines here; the workflow rules about the type matching the branch, the issue number and
// the Step trailer are checked by scripts/check-commits.ts.
const errorLevel = 2;

const commitlintConfig = {
  extends: ['@commitlint/config-conventional'],
  rules: {
    'header-max-length': [errorLevel, 'always', 100],
  },
};

export default commitlintConfig;
