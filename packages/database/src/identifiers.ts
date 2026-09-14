import { v7 as uuidV7 } from "uuid";

export function createPublicId(unixTimeMilliseconds?: number): string {
  if (unixTimeMilliseconds === undefined) {
    return uuidV7();
  }

  if (!Number.isSafeInteger(unixTimeMilliseconds) || unixTimeMilliseconds < 0) {
    throw new RangeError("unixTimeMilliseconds deve ser um inteiro seguro não negativo.");
  }

  return uuidV7({ msecs: unixTimeMilliseconds });
}
