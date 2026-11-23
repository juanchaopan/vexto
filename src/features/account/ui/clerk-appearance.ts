// How Clerk's components look and what they say, given to the Clerk provider in the root layout:
// the vexto colours, the vexto logo, Google as one full-width button, the sign-in heading of the
// design (.docs/design/screens.md, 登录), and no link to a separate sign-up page, since a new
// Google account signs up in the sign-in flow.

export const clerkAppearance = {
  variables: {
    colorPrimary: 'var(--color-accent)',
    colorPrimaryForeground: 'var(--color-on-accent)',
    colorForeground: 'var(--color-ink)',
    colorMutedForeground: 'var(--color-muted)',
    colorBackground: 'var(--color-surface)',
    colorBorder: 'var(--color-line)',
    colorInput: 'var(--color-surface)',
    colorInputForeground: 'var(--color-ink)',
    fontFamily: 'var(--font-sans)',
    fontSize: '14px',
    borderRadius: '4px',
  },
  options: {
    logoImageUrl: '/vexto-logo.svg',
    socialButtonsVariant: 'blockButton' as const,
  },
  elements: {
    footerAction: { display: 'none' },
  },
};

// The sign-in page signs new accounts up in the same flow, and Clerk then shows its "combined"
// heading, so both headings carry the design's words.
const signInHeading = {
  title: 'Sign in to vexto',
  titleCombined: 'Sign in to vexto',
  subtitle: 'Welcome! Please sign in to continue.',
  subtitleCombined: 'Welcome! Please sign in to continue.',
};

export const clerkLocalization = {
  signIn: { start: signInHeading },
};
