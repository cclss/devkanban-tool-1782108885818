// Shared UI package entry point.
//
// At the scaffolding grain this package exposes only headless primitives and
// the `cn` className helper — concrete visual components (with their design
// tokens) are layered on in later grains.

export { cn } from './cn';
export { Slot } from '@radix-ui/react-slot';
