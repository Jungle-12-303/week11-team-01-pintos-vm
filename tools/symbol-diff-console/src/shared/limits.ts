import { z } from "zod";

export const defaultLimits = {
  maxChangedFiles: 80,
  maxFileBytes: 240_000,
  maxSymbols: 500,
  maxHunkLines: 180,
  maxRenderedSymbols: 200,
  gitTimeoutMs: 10_000,
  gitMaxBufferBytes: 12 * 1024 * 1024
} as const;

export const limitsSchema = z.object({
  maxChangedFiles: z.number().int().positive(),
  maxFileBytes: z.number().int().positive(),
  maxSymbols: z.number().int().positive(),
  maxHunkLines: z.number().int().positive(),
  maxRenderedSymbols: z.number().int().positive(),
  gitTimeoutMs: z.number().int().positive(),
  gitMaxBufferBytes: z.number().int().positive()
});

export type CompareLimits = z.infer<typeof limitsSchema>;

export function withDefaultLimits(overrides: Partial<CompareLimits> = {}): CompareLimits {
  return limitsSchema.parse({ ...defaultLimits, ...overrides });
}
