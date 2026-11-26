/** Describes saved agent job schedules in plain language, keeping any schedule it cannot read unchanged. */

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const DAY_NAMES = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
const MONTH_NAMES = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

/** Returns a readable description of a five-field cron expression, or the schedule as saved. */
export function describeSchedule(schedule: string): string {
  const fields = schedule.trim().split(/\s+/);
  if (fields.length !== 5) return schedule;
  const [minute, hour, dayOfMonth, month, dayOfWeek] = fields;
  const time = describeTime(minute, hour);
  const days = describeDays(dayOfMonth, month, dayOfWeek);
  if (!time || !days) return schedule;
  return time.recurring
    ? days === "Every day" ? time.text : `${time.text}, ${lowerFirst(days)}`
    : `${days} at ${time.text}`;
}

function describeTime(minute: string, hour: string): { text: string; recurring: boolean } | undefined {
  const minutes = values(minute, 0, 59);
  const minuteStep = step(minute, 0, 59);
  const hourStep = step(hour, 0, 23);

  if (hour === "*") {
    if (minute === "*") return { text: "Every minute", recurring: true };
    if (minuteStep) return { text: `Every ${minuteStep} minutes`, recurring: true };
    if (minutes?.length === 1) {
      return { text: minutes[0] === 0 ? "Every hour" : `Every hour at :${pad(minutes[0])}`, recurring: true };
    }
    return undefined;
  }
  if (hourStep && minutes?.length === 1) {
    const every = hourStep === 1 ? "Every hour" : `Every ${hourStep} hours`;
    return { text: minutes[0] === 0 ? every : `${every} at :${pad(minutes[0])}`, recurring: true };
  }
  const hours = values(hour, 0, 23);
  if (!hours || minutes?.length !== 1 || hours.length > 4) return undefined;
  return { text: list(hours.map((value) => `${pad(value)}:${pad(minutes[0])}`)), recurring: false };
}

function describeDays(dayOfMonth: string, month: string, dayOfWeek: string): string | undefined {
  const months = month === "*" ? [] : values(month, 1, 12, MONTH_NAMES, 1);
  if (!months) return undefined;
  const inMonths = months.length ? ` in ${list(months.map((value) => MONTHS[value - 1]))}` : "";

  if (dayOfMonth === "*" && dayOfWeek === "*") return "Every day" + inMonths;
  if (dayOfMonth === "*") {
    const weekdays = values(dayOfWeek, 0, 7, DAY_NAMES);
    if (!weekdays) return undefined;
    const days = [...new Set(weekdays.map((value) => value % 7))].sort((a, b) => a - b);
    const label = days.join() === "1,2,3,4,5" ? "Weekdays"
      : days.join() === "0,6" ? "Weekends"
        : days.length === 7 ? "Every day"
          : days.length === 1 ? `Every ${DAYS[days[0]]}` : list(days.map((value) => DAYS[value] + "s"));
    return label + inMonths;
  }
  // Cron runs when either day field matches, which a short sentence would misstate.
  if (dayOfWeek !== "*") return undefined;
  const dates = values(dayOfMonth, 1, 31);
  if (!dates) return undefined;
  const on = list(dates.map(ordinal));
  return months.length ? `On the ${on}${inMonths}` : `Monthly on the ${on}`;
}

/** Expands numbers, names, ranges, and comma lists; returns undefined for anything else. */
function values(field: string, min: number, max: number, names: string[] = [], nameOffset = 0): number[] | undefined {
  const result: number[] = [];
  for (const part of field.split(",")) {
    const range = part.split("-");
    if (range.length > 2) return undefined;
    const start = parse(range[0], names, nameOffset);
    const end = range.length === 2 ? parse(range[1], names, nameOffset) : start;
    if (start === undefined || end === undefined || start < min || end > max || start > end) return undefined;
    for (let value = start; value <= end; value++) result.push(value);
  }
  return [...new Set(result)];
}

function parse(value: string, names: string[], offset: number): number | undefined {
  if (/^\d+$/.test(value)) return Number(value);
  const index = names.indexOf(value.toLowerCase());
  return index === -1 ? undefined : index + offset;
}

/** Reads a whole-range step such as every 15 minutes; offsets and partial ranges are not described. */
function step(field: string, min: number, max: number): number | undefined {
  const match = /^(?:\*|(\d+)-(\d+))\/(\d+)$/.exec(field);
  if (!match) return undefined;
  if (match[1] !== undefined && (Number(match[1]) !== min || Number(match[2]) !== max)) return undefined;
  const size = Number(match[3]);
  return size > 0 && size <= max ? size : undefined;
}

function list(items: string[]): string {
  return items.length < 3 ? items.join(" and ") : `${items.slice(0, -1).join(", ")}, and ${items.at(-1)}`;
}

function ordinal(value: number): string {
  const suffix = value % 100 >= 11 && value % 100 <= 13 ? "th" : ["th", "st", "nd", "rd"][value % 10] ?? "th";
  return value + suffix;
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

function lowerFirst(text: string): string {
  return /^(Every|Weekdays|Weekends|On|Monthly)/.test(text) ? text.charAt(0).toLowerCase() + text.slice(1) : text;
}
