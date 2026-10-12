/**
 * Nazwy akcji USOSweb (`kontroler.php?_action=...`).
 * Ustalasz je raz przez ./scripts/capture.sh discover i wklejasz do .env —
 * bez dotykania kodu, bo w kazdej instalacji moga sie roznic.
 */
export interface Actions {
  home: string
  student: string | null
  /** Strona osoby w katalogu — zrodlo imienia i nazwiska. */
  profile: string
  grades: string
  stages: string
}

export const loadActions = (): Actions => ({
  home: process.env.ACTION_HOME?.trim() || 'home/index',
  student: process.env.ACTION_STUDENT?.trim() || null,
  profile: process.env.ACTION_PROFILE?.trim() || 'katalog2/osoby/pokazOsobe',
  grades: process.env.ACTION_GRADES?.trim() || 'dla_stud/studia/oceny/index',
  stages: process.env.ACTION_STAGES?.trim() || 'dla_stud/studia/zaliczenia/index',
})
