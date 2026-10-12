/** Only explicit statuses count; missing, negative and conditional states do not. */
export function isStagePassed(value: string): boolean {
  return (
    /zaliczon|zdan|ukończ/i.test(value) &&
    !/warunk|nie[\s-]*(?:zalicz|zdan|ukończ)|powtarz|skreśl/i.test(value)
  )
}
export function registrationIsOpen(value: string): boolean {
  return (
    /otwart|aktywn|\btrwa\b/i.test(value) &&
    !/nieakty|nie.*(?:otwart|trwa)|zakończ|zamknięt/i.test(value)
  )
}
export function applicationNeedsAttention(value: string): boolean {
  return (
    /wymaga.*(?:uzupeł|popraw|akcj)|do (?:uzupełnienia|poprawy)/i.test(value) &&
    !/nie wymaga|bez (?:popraw|uzupeł)/i.test(value)
  )
}
