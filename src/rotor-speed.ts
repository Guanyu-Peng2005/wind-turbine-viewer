export const MIN_ROTOR_RPM=0;
export const MAX_ROTOR_RPM=20;
export function normalizeRotorSpeed(value:number):number{
  return Number.isFinite(value)?Math.round(Math.min(MAX_ROTOR_RPM,Math.max(MIN_ROTOR_RPM,value))*2)/2:10;
}
