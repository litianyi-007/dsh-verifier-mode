/** Wall clock for peak/off-peak pricing. Tests replace `now` so the tier does not follow the host clock. */
export const costClock = {
  now(): Date {
    return new Date()
  },
}
