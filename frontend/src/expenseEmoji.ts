// Maps expense descriptions to matching emojis using emoji-js
// @ts-expect-error emoji-js has no type declarations
import EmojiConvertor from 'emoji-js';

const emojiConvertor = new EmojiConvertor();

// Build a search index: map words from shortcode names to their native emoji
interface EmojiEntry {
  words: string[];
  char: string;
  name: string;
}

const emojiIndex: EmojiEntry[] = [];
for (const key in emojiConvertor.data) {
  const entry = emojiConvertor.data[key];
  const names: string[] = entry[3];
  const unified: string[] = entry[0];
  if (!names?.length || !unified?.length) continue;
  const char = unified[0];
  for (const name of names) {
    const words = name.split('_').filter((w: string) => w.length > 1);
    emojiIndex.push({ words, char, name });
  }
}

// Priority overrides: map description keywords to specific shortcode names
// This ensures common expense words get the best emoji even when emoji-js
// has many matches (e.g. "bus" → "bus" not "bust_in_silhouette")
const KEYWORD_TO_SHORTCODE: [RegExp, string][] = [
  // Food & Drink
  [/\b(grocery|groceries|supermarket|lebensmittel|einkauf|einkäufe)\b/i, 'shopping_trolley'],
  [/\b(restaurant|dinner|lunch|dine|dining|essen gehen|abendessen|mittagessen)\b/i, 'fork_and_knife'],
  [/\b(breakfast|brunch|frühstück)\b/i, 'croissant'],
  [/\b(café|cafe|kaffee|starbucks)\b/i, 'coffee'],
  [/\b(bier|brewery|brauerei|pub)\b/i, 'beer'],
  [/\b(wein|vino)\b/i, 'wine_glass'],
  [/\b(cocktail|drinks?|getränke)\b/i, 'tropical_drink'],
  [/\b(ice\s*cream|gelato|eis)\b/i, 'ice_cream'],
  [/\b(snack|chips|candy|süßigkeiten)\b/i, 'popcorn'],
  [/\b(bakery|bäckerei|brot)\b/i, 'bread'],
  [/\b(food|essen|meal|cook|cooking|kochen)\b/i, 'cooking'],
  // Transport
  [/\b(uber|lyft|taxi|cab|ride)\b/i, 'taxi'],
  [/\b(flight|flug|airplane|airline|avion)\b/i, 'airplane'],
  [/\b(bahn|zug|rail|tgv|ice)\b/i, 'train2'],
  [/\b(bus)\b/i, 'bus'],
  [/\b(gas|fuel|petrol|benzin|tanken|tankstelle)\b/i, 'fuelpump'],
  [/\b(parking|parken|parkplatz)\b/i, 'parking'],
  [/\b(toll|maut)\b/i, 'motorway'],
  [/\b(auto|rental|mietwagen|voiture)\b/i, 'red_car'],
  [/\b(boat|ferry|fähre|boot|ship)\b/i, 'ferry'],
  [/\b(transport|transit|fahrt|travel|reise)\b/i, 'tram'],
  // Accommodation
  [/\b(airbnb|apartment|wohnung|accommodation|unterkunft|lodge|cabin|hütte|rent|miete)\b/i, 'house'],
  [/\b(camping|camp|tent|zelt)\b/i, 'camping'],
  // Entertainment
  [/\b(movie|cinema|kino|film)\b/i, 'clapper'],
  [/\b(concert|musik|music|gig)\b/i, 'musical_note'],
  [/\b(museum|gallery|galerie|ausstellung)\b/i, 'classical_building'],
  [/\b(theater|theatre)\b/i, 'performing_arts'],
  [/\b(game|spiel|arcade|bowling)\b/i, 'video_game'],
  [/\b(ticket|eintritt|entrance|entry)\b/i, 'admission_tickets'],
  [/\b(party|feier|celebration)\b/i, 'tada'],
  [/\b(karaoke|club|disco)\b/i, 'mirror_ball'],
  [/\b(sport|gym|fitness|training)\b/i, 'weight_lifter'],
  [/\b(ski|skiing|snowboard)\b/i, 'skier'],
  [/\b(swim|pool|schwimm|beach|strand)\b/i, 'beach_with_umbrella'],
  [/\b(hike|hiking|wander|wanderung|trek)\b/i, 'hiking_boot'],
  [/\b(bike|bicycle|fahrrad|cycling)\b/i, 'bike'],
  [/\b(spa|massage|wellness|sauna)\b/i, 'massage'],
  // Shopping
  [/\b(clothes|clothing|kleidung|fashion|mode)\b/i, 'dress'],
  [/\b(shoes?|schuhe?)\b/i, 'athletic_shoe'],
  [/\b(geschenk|present|cadeau)\b/i, 'gift'],
  [/\b(electronics?|tech|computer|laptop)\b/i, 'computer'],
  [/\b(phone|handy|telefon|mobile)\b/i, 'iphone'],
  [/\b(book|buch|bücher|books)\b/i, 'books'],
  [/\b(shopping|einkaufen|shop)\b/i, 'shopping_bags'],
  // Home & Utilities
  [/\b(electricity|strom|electric|power)\b/i, 'zap'],
  [/\b(water|wasser)\b/i, 'droplet'],
  [/\b(internet|wifi|wi-fi|wlan)\b/i, 'signal_strength'],
  [/\b(subscription|abo|abonnement|netflix|spotify|streaming)\b/i, 'tv'],
  [/\b(insurance|versicherung)\b/i, 'shield'],
  [/\b(cleaning|reinigung|putzen|clean)\b/i, 'broom'],
  [/\b(laundry|wäsche|waschen)\b/i, 'shirt'],
  [/\b(furniture|möbel)\b/i, 'couch_and_lamp'],
  // Health
  [/\b(pharmacy|apotheke|medicine|medizin|drug)\b/i, 'pill'],
  [/\b(doctor|arzt|hospital|krankenhaus|medical)\b/i, 'hospital'],
  [/\b(dentist|zahnarzt)\b/i, 'tooth'],
  // Misc
  [/\b(tip|trinkgeld|pourboire)\b/i, 'dollar'],
  [/\b(tax|taxes|steuer|steuern)\b/i, 'clipboard'],
  [/\b(donation|spende)\b/i, 'heart'],
  [/\b(salary|gehalt|wage|lohn|pay|zahlung)\b/i, 'moneybag'],
  [/\b(refund|rückerstattung|erstattung)\b/i, 'leftwards_arrow_with_hook'],
  [/\b(photo|foto|camera|kamera)\b/i, 'camera'],
  [/\b(haircut|friseur|hairdresser|barber)\b/i, 'haircut'],
  [/\b(pet|haustier|dog|hund|cat|katze)\b/i, 'paw_prints'],
  [/\b(baby|kind|child|children|kinder)\b/i, 'baby'],
  [/\b(school|schule|education|bildung|uni|university)\b/i, 'mortar_board'],
  [/\b(office|büro)\b/i, 'office'],
  [/\b(repair|reparatur|fix)\b/i, 'wrench'],
  [/\b(settlement|ausgleich|balance\s*transfer)\b/i, 'handshake'],
];

// Lookup shortcode → native emoji char using emoji-js data
const shortcodeToChar: Record<string, string> = {};
for (const key in emojiConvertor.data) {
  const entry = emojiConvertor.data[key];
  const names: string[] = entry[3];
  const unified: string[] = entry[0];
  if (!names?.length || !unified?.length) continue;
  for (const name of names) {
    shortcodeToChar[name] = unified[0];
  }
}

function findByShortcode(shortcode: string): string | null {
  return shortcodeToChar[shortcode] ?? null;
}

// Search emoji-js data by keyword (word-level match against shortcode names)
function searchEmoji(keyword: string): string | null {
  const lower = keyword.toLowerCase();
  // Exact shortcode name match
  const exact = findByShortcode(lower);
  if (exact) return exact;
  // Word boundary match: find entries where a word in the shortcode name equals the keyword
  for (const entry of emojiIndex) {
    if (entry.words.includes(lower)) return entry.char;
  }
  // Substring match as fallback
  for (const entry of emojiIndex) {
    if (entry.name.includes(lower)) return entry.char;
  }
  return null;
}

const TYPE_EMOJI: Record<string, string> = {
  transfer: '💸',
  income: '💰',
};

const DEFAULT_EMOJI = '💳';

export function getExpenseEmoji(description: string, expenseType: string): string {
  if (TYPE_EMOJI[expenseType]) return TYPE_EMOJI[expenseType];

  // 1. Try priority keyword overrides (maps description keywords to specific shortcodes)
  for (const [re, shortcode] of KEYWORD_TO_SHORTCODE) {
    if (re.test(description)) {
      const char = findByShortcode(shortcode);
      if (char) return char;
    }
  }

  // 2. Try searching emoji-js data by each word in the description
  const words = description.toLowerCase().split(/[\s,;:!?.()\-/]+/).filter(w => w.length > 2);
  for (const word of words) {
    const result = searchEmoji(word);
    if (result) return result;
  }

  return DEFAULT_EMOJI;
}
