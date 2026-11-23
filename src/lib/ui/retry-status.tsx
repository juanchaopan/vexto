// A failure shown where the content would be (.docs/design/screens.md, 进行中和失败): an alert
// icon, the failure and, when sending the request again can help, a Retry button.
import { Button } from './button.tsx';
import { Icon } from './icon.tsx';

export type RetryStatusProps = {
  message: string;
  /** Sends the same request again; no Retry button without it. */
  onRetry?: () => void;
  className?: string;
};

export function RetryStatus({ message, onRetry, className = '' }: RetryStatusProps) {
  return (
    <div role="alert" className={`flex items-center gap-2 text-xs text-danger ${className}`}>
      <Icon name="circle-alert" />
      <span>{message}</span>
      {onRetry ? (
        <Button className="ml-auto text-ink" onClick={onRetry}>
          <Icon name="refresh-cw" />
          Retry
        </Button>
      ) : null}
    </div>
  );
}
