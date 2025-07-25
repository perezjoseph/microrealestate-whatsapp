// Need to keep additional keys in scripts/.keptKeys.json as the locale loader cannot be customized
// to get the locales from commonui package so far
// https://github.com/aralroca/next-translate/issues/851#issuecomment-1173611946
module.exports = {
  locales: ['en', 'fr-FR', 'pt-BR', 'de-DE', 'es-CO', 'es-DO'],
  defaultLocale: 'es-DO',
  pages: {
    '*': ['common']
  },
  keySeparator: false,
  nsSeparator: false
};
