/** PPA net schedule (MW) — matches the Net Schedule table column; excludes RTM surplus above commitment. */
export function ppaNetScheduleMw(netSchedule: number, rtcCommitment: number): number {
  return Math.min(netSchedule, rtcCommitment);
}
