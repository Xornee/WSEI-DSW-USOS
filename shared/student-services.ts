import type { SourceLink } from './sections';

export const STUDENT_SERVICES = [
  { id: 'allocations', title: 'Podpięcia i ECTS', description: 'Przypisanie przedmiotów do programu i etapu. Oficjalne punkty wyłącznie z danych uczelni.', roots: ['dla_stud/studia/podpiecia/'] },
  { id: 'surveys', title: 'Ankiety', description: 'Dostępne ankiety, pytania i wysłanie odpowiedzi po potwierdzeniu.', roots: ['dla_stud/studia/ankiety/'] },
  { id: 'exams', title: 'Egzaminy', description: 'Terminy i sesje egzaminacyjne — oddzielnie od sprawdzianów.', roots: ['dla_stud/studia/egzaminy/', 'dla_stud/rejestracja/egzaminy/'] },
  { id: 'primary-groups', title: 'Grupy dziekańskie', description: 'Przynależność do grup wskazana przez uczelnię; nie zgadujemy grup z nazwy toku.', roots: ['dla_stud/studia/grupyDziekanskie'] },
  { id: 'rankings', title: 'Rankingi', description: 'Rankingi udostępnione dla Twojego konta i etapu.', roots: ['dla_stud/studia/rankingi'] },
  { id: 'meetings', title: 'Spotkania i konsultacje', description: 'Dostępne spotkania i formularze zapisów uczelni.', roots: ['dla_stud/spotkania/'] },
  { id: 'mail', title: 'USOSmail', description: 'Wiadomości i adresaci udostępnieni w module uczelni.', roots: ['usosmail/', 'dla_stud/usosmail/'] },
  { id: 'internships', title: 'Praktyki', description: 'Rzeczywista sprawa praktyk, jeżeli konto ma dostęp do modułu.', roots: ['dla_stud/studia/praktyki/', 'dodatki/praktyki/'] },
  { id: 'clearances', title: 'Obiegówki', description: 'Status zobowiązań i czynności dostępnych w obiegówce.', roots: ['dla_stud/studia/obiegowki/', 'dodatki/obiegowki/'] },
  { id: 'statements', title: 'Oświadczenia', description: 'Treść oświadczeń i formularze potwierdzenia.', roots: ['dla_stud/studia/oswiadczenia/', 'dodatki/oswiadczenia/'] },
  { id: 'notifications', title: 'Powiadomienia uczelni', description: 'Oficjalne wiadomości i ustawienia kanałów, jeżeli uczelnia je udostępnia.', roots: ['dla_stud/powiadomienia/', 'powiadomienia/'] },
] as const;

export interface StudentServices {
  inspectedAt: string;
  services: { id: string; title: string; description: string; state: 'discovered' | 'not_discovered'; link: SourceLink | null }[];
}
