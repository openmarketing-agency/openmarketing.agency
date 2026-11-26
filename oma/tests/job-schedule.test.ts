/** Verifies that agent job schedules read as plain language and unreadable schedules stay as saved. */

import assert from "node:assert/strict";
import { test } from "node:test";

import { describeSchedule } from "../lib/job-schedule";

test("describes common cron schedules", () => {
  const cases: [string, string][] = [
    ["41 15 * * 4", "Every Thursday at 15:41"],
    ["0 9 * * 1-5", "Weekdays at 09:00"],
    ["30 10 * * sat,SUN", "Weekends at 10:30"],
    ["0 9 * * 1,4", "Mondays and Thursdays at 09:00"],
    ["0 9 * * 0-7", "Every day at 09:00"],
    ["0 9 * * 7", "Every Sunday at 09:00"],
    ["5 8 * * *", "Every day at 08:05"],
    ["0 9,17 * * *", "Every day at 09:00 and 17:00"],
    ["0 9 1 * *", "Monthly on the 1st at 09:00"],
    ["0 9 1,15 * *", "Monthly on the 1st and 15th at 09:00"],
    ["0 9 22 jan *", "On the 22nd in January at 09:00"],
    ["0 9 * 3-4 1", "Every Monday in March and April at 09:00"],
    ["*/15 * * * *", "Every 15 minutes"],
    ["* * * * *", "Every minute"],
    ["0 * * * *", "Every hour"],
    ["41 * * * *", "Every hour at :41"],
    ["0 */6 * * *", "Every 6 hours"],
    ["15 */2 * * 1-5", "Every 2 hours at :15, weekdays"],
  ];
  for (const [schedule, expected] of cases) assert.equal(describeSchedule(schedule), expected, schedule);
});

test("keeps schedules it cannot describe exactly", () => {
  for (const schedule of [
    "every 30m", "2026-12-01T09:00:00Z", "0 9 1 * 1", "*/15 9 * * *", "5/15 * * * *",
    "0 9 * * 8", "61 9 * * *", "0 9 * * mon-fri/2", "0 9 * * * *", "",
  ]) assert.equal(describeSchedule(schedule), schedule, schedule);
});
