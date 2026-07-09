/**
 * Sign-field geometry — the coordinate-system bridge between the placement canvas
 * and the persisted, page-relative field model.
 *
 * The contract itself (normalized `0..1`, PDF bottom-left origin, per-type default
 * footprints, and the in-page clamp) now lives in `@repo/field-geometry`, the
 * single source of truth shared with the API. This module re-exports it so the
 * web placement code keeps importing from `@/lib/field-geometry` unchanged while
 * the convention can never diverge between web and api.
 */

export * from '@repo/field-geometry';
