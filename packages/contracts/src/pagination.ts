import { z } from "zod";

export const paginationCursorSchema = z.string().trim().min(1).max(512);
export const pageSizeSchema = z.coerce.number().int().min(1).max(100).default(20);

export const paginationRequestSchema = z
  .object({
    cursor: paginationCursorSchema.optional(),
    pageSize: pageSizeSchema,
  })
  .readonly();

export function createPaginatedResponseSchema<const ItemSchema extends z.ZodType>(
  itemSchema: ItemSchema,
) {
  return z
    .object({
      items: z.array(itemSchema),
      nextCursor: paginationCursorSchema.nullable(),
    })
    .readonly();
}

export type PaginationRequest = z.infer<typeof paginationRequestSchema>;
