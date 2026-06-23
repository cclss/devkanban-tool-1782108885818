// Shared UI package entry point.
//
// Headless, stateless design-system primitives. Every visual value comes from
// the design tokens (Tailwind theme ⇄ CSS custom properties); components never
// hardcode raw colors, spacing, radii, or motion values.

export { cn } from './cn';
export { Slot } from '@radix-ui/react-slot';

export { Button, buttonVariants, type ButtonProps } from './components/button';
export {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
  type CardProps,
} from './components/card';
export { Input, type InputProps } from './components/input';
export { Field, Label, type FieldProps, type LabelProps } from './components/field';
export { Skeleton, type SkeletonProps } from './components/skeleton';
export { StepIndicator, type StepIndicatorProps } from './components/step-indicator';
export {
  Dialog,
  DialogTrigger,
  DialogClose,
  DialogPortal,
  DialogOverlay,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
  type DialogContentProps,
} from './components/dialog';
export {
  Sheet,
  SheetTrigger,
  SheetClose,
  SheetContent,
  SheetHeader,
  SheetFooter,
  SheetTitle,
  SheetDescription,
  type SheetContentProps,
} from './components/sheet';
export { SuccessCheck, type SuccessCheckProps } from './components/success-check';
export { Confetti, type ConfettiProps } from './components/confetti';
