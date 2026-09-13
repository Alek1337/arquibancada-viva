import { z } from "zod";

const ISO_UTC_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?Z$/u;

function isLeapYear(year: number) {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

function isValidIsoUtcDateTime(value: string) {
  const match = ISO_UTC_PATTERN.exec(value);
  if (!match) {
    return false;
  }

  const [, yearText, monthText, dayText, hourText, minuteText, secondText] = match;
  if (!yearText || !monthText || !dayText || !hourText || !minuteText || !secondText) {
    return false;
  }

  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const second = Number(secondText);
  const daysPerMonth = [31, isLeapYear(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  const maximumDay = daysPerMonth[month - 1];

  return (
    maximumDay !== undefined &&
    day >= 1 &&
    day <= maximumDay &&
    hour <= 23 &&
    minute <= 59 &&
    second <= 59
  );
}

export const isoUtcDateTimeSchema = z
  .string()
  .refine(isValidIsoUtcDateTime, "deve ser um instante ISO 8601 válido em UTC");

export type IsoUtcDateTime = z.infer<typeof isoUtcDateTimeSchema>;
