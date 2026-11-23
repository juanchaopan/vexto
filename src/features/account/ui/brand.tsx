// The vexto mark: a white letter v on the accent colour, with the name beside it. The top bar on a
// phone shows the mark alone, which then carries the name for screen readers.

export type BrandProps = {
  size?: 'small' | 'big';
  showName?: boolean;
};

export function Brand({ size = 'small', showName = true }: BrandProps) {
  const big = size === 'big';
  const mark = (
    <b
      aria-hidden="true"
      className={`grid place-items-center rounded-[5px] bg-accent text-on-accent ${
        big ? 'h-[34px] w-8 text-xl' : 'h-[25px] w-[23px] text-[15px]'
      }`}
    >
      v
    </b>
  );
  if (!showName) {
    return (
      <span role="img" aria-label="vexto" className="flex flex-none">
        {mark}
      </span>
    );
  }
  return (
    <span
      className={`flex flex-none items-center gap-1.5 font-[650] tracking-[-0.4px] ${
        big ? 'justify-center text-xl' : 'text-[13px]'
      }`}
    >
      {mark}
      <span>vexto</span>
    </span>
  );
}
