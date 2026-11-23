// The interface's button (.docs/design/screens.md, 视觉): at least 44×44 CSS pixels, a thin border
// and a small radius. `primary` is the filled main action, `flat` has no border or fill, and the
// `icon` shape is a square button that shows only an icon.
import type { ButtonHTMLAttributes } from 'react';

export type ButtonVariant = 'default' | 'primary' | 'flat';

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  shape?: 'text' | 'icon';
};

const base =
  'inline-flex min-h-11 items-center justify-center gap-1.5 whitespace-nowrap rounded border font-medium [-webkit-tap-highlight-color:transparent] disabled:opacity-45';

const variants: Record<ButtonVariant, string> = {
  default:
    'border-line bg-linear-to-b from-surface to-page shadow-[0_1px_1px_#00000008] active:shadow-[inset_0_1px_3px_#00000025]',
  primary:
    'border-accent bg-linear-to-b from-[color-mix(in_srgb,var(--color-accent),#fff_6%)] to-accent text-on-accent shadow-[0_1px_1px_#00000008] active:shadow-[inset_0_1px_3px_#00000025]',
  flat: 'border-transparent bg-transparent',
};

const shapes = {
  text: 'px-2.5 py-1',
  icon: 'w-11 flex-none p-1',
};

export function buttonClassName(
  variant: ButtonVariant = 'default',
  shape: 'text' | 'icon' = 'text',
) {
  return `${base} ${variants[variant]} ${shapes[shape]}`;
}

export function Button({
  variant = 'default',
  shape = 'text',
  className = '',
  type = 'button',
  ...props
}: ButtonProps) {
  return (
    <button type={type} className={`${buttonClassName(variant, shape)} ${className}`} {...props} />
  );
}
