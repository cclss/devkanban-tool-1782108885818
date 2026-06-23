import { cn } from '@repo/ui';

/**
 * BlobBackground — slow-flowing gradient blobs (the `blob-flow` motion pattern).
 *
 * Three large, blurred, low-opacity color fields drift on the 18s `animate-blob`
 * loop, each offset by a negative `animationDelay` so they're desynchronized.
 * Purely decorative: `aria-hidden`, `pointer-events-none`, and it sits behind
 * content. Under `prefers-reduced-motion` the blobs freeze into a soft static
 * gradient (handled globally in `globals.css`), so the surface still reads well.
 */
export function BlobBackground({ className }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={cn('pointer-events-none absolute inset-0 overflow-hidden', className)}
    >
      <span
        className="absolute -left-[10%] -top-[10%] h-[42vmax] w-[42vmax] animate-blob rounded-full bg-primary opacity-[0.18] blur-3xl"
        style={{ animationDelay: '0s' }}
      />
      <span
        className="absolute -right-[12%] top-[8%] h-[38vmax] w-[38vmax] animate-blob rounded-full bg-success opacity-[0.14] blur-3xl"
        style={{ animationDelay: '-6s' }}
      />
      <span
        className="absolute -bottom-[14%] left-1/4 h-[40vmax] w-[40vmax] animate-blob rounded-full bg-primary-subtle opacity-60 blur-3xl"
        style={{ animationDelay: '-12s' }}
      />
    </div>
  );
}
