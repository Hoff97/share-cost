import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';
import en from './locales/en.json';
import de from './locales/de.json';
import fr from './locales/fr.json';
import it from './locales/it.json';
import es from './locales/es.json';
import pl from './locales/pl.json';
import bar from './locales/bar.json';

export const LANGUAGES = [
  { code: 'en', flag: '🇬🇧', label: '🇬🇧 English' },
  { code: 'de', flag: '🇩🇪', label: '🇩🇪 Deutsch' },
  { code: 'fr', flag: '🇫🇷', label: '🇫🇷 Français' },
  { code: 'it', flag: '🇮🇹', label: '🇮🇹 Italiano' },
  { code: 'es', flag: '🇪🇸', label: '🇪🇸 Español' },
  { code: 'pl', flag: '🇵🇱', label: '🇵🇱 Polski' },
  { code: 'bar', flag: '🥨', label: '🥨 Boarisch' },
] as const;

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: {
      en: { translation: en },
      de: { translation: de },
      fr: { translation: fr },
      it: { translation: it },
      es: { translation: es },
      pl: { translation: pl },
      bar: { translation: bar },
    },
    fallbackLng: 'en',
    interpolation: { escapeValue: false },
    detection: {
      order: ['localStorage', 'navigator'],
      caches: ['localStorage'],
      lookupLocalStorage: 'share-cost-language',
    },
  });

export default i18n;
