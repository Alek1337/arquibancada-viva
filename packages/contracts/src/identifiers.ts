import { z } from "zod";

export const uuidV7Schema = z.uuidv7();

export type UuidV7 = z.infer<typeof uuidV7Schema>;
