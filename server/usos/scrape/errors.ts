/**
 * Rzucane, dopoki parser nie zostal skalibrowany na prawdziwym HTML-u.
 * USOSweb nie ma stabilnego kontraktu — parsery pisze sie na zrzutach
 * z konkretnej instalacji, nie z glowy.
 */
export class ParserNotCalibratedError extends Error {
  constructor(public readonly screen: string) {
    super(
      `Parser ekranu "${screen}" nie jest jeszcze skalibrowany. ` +
        `Uruchom: ./scripts/capture.sh discover, potem grab <akcja> ${screen}`,
    )
    this.name = 'ParserNotCalibratedError'
  }
}
