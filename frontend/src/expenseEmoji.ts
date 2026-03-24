// Maps expense descriptions to matching emojis using keyword matching

const KEYWORD_EMOJI: [RegExp, string][] = [
  // Food & Drink
  [/\b(grocery|groceries|supermarket|lebensmittel|einkauf|einkäufe)\b/i, '🛒'],
  [/\b(restaurant|dinner|lunch|dine|dining|essen gehen|abendessen|mittagessen)\b/i, '🍽️'],
  [/\b(pizza)\b/i, '🍕'],
  [/\b(burger|hamburger)\b/i, '🍔'],
  [/\b(sushi)\b/i, '🍣'],
  [/\b(breakfast|brunch|frühstück)\b/i, '🥐'],
  [/\b(coffee|café|cafe|kaffee|starbucks)\b/i, '☕'],
  [/\b(beer|bier|brewery|brauerei|pub)\b/i, '🍺'],
  [/\b(wine|wein|vino)\b/i, '🍷'],
  [/\b(cocktail|drinks?|bar|getränke)\b/i, '🍹'],
  [/\b(ice\s*cream|gelato|eis)\b/i, '🍦'],
  [/\b(snack|chips|candy|süßigkeiten)\b/i, '🍿'],
  [/\b(bakery|bäckerei|bread|brot)\b/i, '🥖'],
  [/\b(food|essen|meal|cook|cooking|kochen)\b/i, '🍳'],

  // Transport
  [/\b(uber|lyft|taxi|cab|ride)\b/i, '🚕'],
  [/\b(flight|flug|plane|airplane|airline|avion)\b/i, '✈️'],
  [/\b(train|bahn|zug|rail|tgv|ice)\b/i, '🚆'],
  [/\b(bus)\b/i, '🚌'],
  [/\b(gas|fuel|petrol|benzin|tanken|tankstelle)\b/i, '⛽'],
  [/\b(parking|parken|parkplatz)\b/i, '🅿️'],
  [/\b(toll|maut)\b/i, '🛣️'],
  [/\b(car|auto|rental|mietwagen|voiture)\b/i, '🚗'],
  [/\b(boat|ferry|fähre|boot|ship)\b/i, '⛴️'],
  [/\b(transport|transit|fahrt|travel|reise)\b/i, '🚃'],

  // Accommodation
  [/\b(hotel|motel|hostel|resort)\b/i, '🏨'],
  [/\b(airbnb|apartment|wohnung|accommodation|unterkunft|lodge|cabin|hütte)\b/i, '🏠'],
  [/\b(camping|camp|tent|zelt)\b/i, '⛺'],
  [/\b(rent|miete)\b/i, '🏠'],

  // Entertainment
  [/\b(movie|cinema|kino|film)\b/i, '🎬'],
  [/\b(concert|musik|music|gig)\b/i, '🎵'],
  [/\b(museum|gallery|galerie|ausstellung)\b/i, '🏛️'],
  [/\b(theater|theatre)\b/i, '🎭'],
  [/\b(game|spiel|arcade|bowling)\b/i, '🎮'],
  [/\b(ticket|eintritt|entrance|entry)\b/i, '🎟️'],
  [/\b(party|feier|celebration)\b/i, '🎉'],
  [/\b(karaoke|club|disco)\b/i, '🪩'],
  [/\b(sport|gym|fitness|training)\b/i, '🏋️'],
  [/\b(ski|skiing|snowboard)\b/i, '⛷️'],
  [/\b(swim|pool|schwimm|beach|strand)\b/i, '🏖️'],
  [/\b(hike|hiking|wander|wanderung|trek)\b/i, '🥾'],
  [/\b(bike|bicycle|fahrrad|cycling)\b/i, '🚲'],
  [/\b(spa|massage|wellness|sauna)\b/i, '💆'],

  // Shopping
  [/\b(clothes|clothing|kleidung|fashion|mode)\b/i, '👗'],
  [/\b(shoes?|schuhe?)\b/i, '👟'],
  [/\b(gift|geschenk|present|cadeau)\b/i, '🎁'],
  [/\b(electronics?|tech|computer|laptop)\b/i, '💻'],
  [/\b(phone|handy|telefon|mobile)\b/i, '📱'],
  [/\b(book|buch|bücher|books)\b/i, '📚'],
  [/\b(shopping|einkaufen|shop)\b/i, '🛍️'],

  // Home & Utilities
  [/\b(electricity|strom|electric|power)\b/i, '⚡'],
  [/\b(water|wasser)\b/i, '💧'],
  [/\b(internet|wifi|wi-fi|wlan)\b/i, '📶'],
  [/\b(subscription|abo|abonnement|netflix|spotify|streaming)\b/i, '📺'],
  [/\b(insurance|versicherung)\b/i, '🛡️'],
  [/\b(cleaning|reinigung|putzen|clean)\b/i, '🧹'],
  [/\b(laundry|wäsche|waschen)\b/i, '👕'],
  [/\b(furniture|möbel)\b/i, '🛋️'],

  // Health
  [/\b(pharmacy|apotheke|medicine|medizin|drug)\b/i, '💊'],
  [/\b(doctor|arzt|hospital|krankenhaus|medical)\b/i, '🏥'],
  [/\b(dentist|zahnarzt)\b/i, '🦷'],

  // Misc
  [/\b(tip|trinkgeld|pourboire)\b/i, '💵'],
  [/\b(tax|taxes|steuer|steuern)\b/i, '📋'],
  [/\b(fee|gebühr)\b/i, '💳'],
  [/\b(donation|spende)\b/i, '❤️'],
  [/\b(salary|gehalt|wage|lohn|pay|zahlung)\b/i, '💰'],
  [/\b(refund|rückerstattung|erstattung)\b/i, '↩️'],
  [/\b(souvenir|andenken)\b/i, '🧲'],
  [/\b(photo|foto|camera|kamera)\b/i, '📷'],
  [/\b(haircut|friseur|hairdresser|barber)\b/i, '💇'],
  [/\b(pet|haustier|dog|hund|cat|katze)\b/i, '🐾'],
  [/\b(baby|kind|child|children|kinder)\b/i, '👶'],
  [/\b(school|schule|education|bildung|uni|university)\b/i, '🎓'],
  [/\b(office|büro)\b/i, '🏢'],
  [/\b(repair|reparatur|fix)\b/i, '🔧'],

  // Settlement / balance
  [/\b(settlement|ausgleich|balance\s*transfer)\b/i, '🤝'],
];

const TYPE_EMOJI: Record<string, string> = {
  transfer: '💸',
  income: '💰',
};

const DEFAULT_EMOJI = '💳';

export function getExpenseEmoji(description: string, expenseType: string): string {
  if (TYPE_EMOJI[expenseType]) return TYPE_EMOJI[expenseType];
  for (const [re, emoji] of KEYWORD_EMOJI) {
    if (re.test(description)) return emoji;
  }
  return DEFAULT_EMOJI;
}
