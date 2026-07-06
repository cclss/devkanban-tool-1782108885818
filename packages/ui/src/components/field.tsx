import * as React from 'react';
import { cn } from '../cn';

/**
 * Label — accessible field label primitive.
 */
export interface LabelProps extends React.LabelHTMLAttributes<HTMLLabelElement> {
  required?: boolean;
}

export const Label = React.forwardRef<HTMLLabelElement, LabelProps>(
  ({ className, required, children, ...props }, ref) => (
    <label
      ref={ref}
      className={cn('text-sm font-semibold text-foreground-muted', className)}
      {...props}
    >
      {children}
      {required ? <span className="ml-0.5 text-danger">*</span> : null}
    </label>
  ),
);
Label.displayName = 'Label';

/**
 * Field — composes a Label, a control, and an optional hint/error message into
 * one labelled, accessible group. The control is provided as children; the
 * field wires `htmlFor`/`aria-describedby` semantics around it.
 */
export interface FieldProps extends React.HTMLAttributes<HTMLDivElement> {
  label?: React.ReactNode;
  htmlFor?: string;
  hint?: React.ReactNode;
  error?: React.ReactNode;
  required?: boolean;
}

export const Field = React.forwardRef<HTMLDivElement, FieldProps>(
  ({ className, label, htmlFor, hint, error, required, children, ...props }, ref) => {
    const messageId = htmlFor ? `${htmlFor}-message` : undefined;
    return (
      <div ref={ref} className={cn('flex flex-col gap-xs', className)} {...props}>
        {label ? (
          <Label htmlFor={htmlFor} required={required}>
            {label}
          </Label>
        ) : null}
        {children}
        {error ? (
          <p id={messageId} className="text-sm text-danger" role="alert">
            {error}
          </p>
        ) : hint ? (
          <p id={messageId} className="text-sm text-foreground-subtle">
            {hint}
          </p>
        ) : null}
      </div>
    );
  },
);
Field.displayName = 'Field';
