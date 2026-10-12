#!/usr/bin/env bash
# Zrzuca HTML z USOSweb do fixtures/ przy uzyciu Twojego ciasteczka sesyjnego.
# Te pliki sa wejsciem dla parserow i testow. Nie commituj ich (.gitignore).
set -euo pipefail

cd "$(dirname "$0")/.."
[ -f .env ] || { echo "Brak .env — skopiuj .env.example i wklej PHPSESSID."; exit 1; }
set -a; . ./.env; set +a
: "${USOS_SESSION:?Pusty USOS_SESSION w .env}"
BASE="${USOS_BASE:-https://usosweb.ideis.pl}"

fetch() { # fetch <action> -> HTML na stdout
  curl -sS -L --max-time 30 --compressed \
    -b "PHPSESSID=${USOS_SESSION}" \
    -H 'Accept: text/html' \
    -H 'User-Agent: usos-local/0.1 (osobisty klient; kontakt: wlasciciel konta)' \
    "${BASE}/kontroler.php?_action=$1"
}

# USOSweb wstrzykuje w kazda strone: JSGLOBALS = { user_id: <id|null> }
# user_id: null == niezalogowany. To najpewniejszy marker, jaki daje ta aplikacja.
assert_logged_in() {
  if grep -qE 'user_id:[[:space:]]*null' <<< "$1"; then
    echo "!! Sesja nieaktywna (user_id: null). Zaloguj sie w przegladarce i wklej swieze PHPSESSID do .env." >&2
    return 1
  fi
}

# discover [action] — domyslnie strona glowna. Podmenu USOSweb maja wlasne
# zestawy linkow, wiec akcje studenckie znajdziesz dopiero wchodzac glebiej.
cmd_discover() {
  local action="${1:-home/index}"
  echo ">> Pobieram _action=${action} i wyciagam linki..."
  local html; html="$(fetch "$action")"
  assert_logged_in "$html"
  local uid; uid="$(grep -oE "user_id:[[:space:]]*['\"]?[0-9]+" <<< "$html" | head -1 | grep -oE '[0-9]+' || true)"
  echo ">> Sesja uczelniana aktywna (identyfikator nie jest wypisywany)."
  echo
  echo ">> Akcje znalezione na tej stronie:"
  grep -oE '_action=[a-zA-Z0-9_/]+' <<< "$html" | sed 's/^_action=//' | sort -u
}

cmd_grab() { # grab <action> <nazwa-pliku>
  local action="$1" name="$2"
  [[ "$name" =~ ^[a-zA-Z0-9_-]+$ ]] || { echo "Podaj prostą nazwę pliku." >&2; return 1; }
  mkdir -p fixtures
  chmod 700 fixtures
  umask 077
  echo -n ">> ${name}  (_action=${action}) ... "
  local html; html="$(fetch "$action")"
  assert_logged_in "$html" || return 1
  printf '%s' "$html" > "fixtures/${name}.html"
  echo "$(wc -c < "fixtures/${name}.html") B -> fixtures/${name}.html"
}

case "${1:-}" in
  discover) cmd_discover "${2:-}" ;;
  grab)     cmd_grab "${2:?podaj _action}" "${3:?podaj nazwe pliku}" ;;
  *) cat <<'USAGE'
Uzycie:
  ./scripts/capture.sh discover [action]     # wypisz linki _action= z danej strony
  ./scripts/capture.sh grab <action> <nazwa> # zapisz HTML do fixtures/<nazwa>.html

Typowo:
  ./scripts/capture.sh discover
  ./scripts/capture.sh grab home/index        home
  ./scripts/capture.sh grab <akcja-planu>     plan
  ./scripts/capture.sh grab <akcja-studenta>  student
USAGE
    exit 1 ;;
esac
