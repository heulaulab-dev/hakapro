/**
 * Pure layout rules for rendering a table row as a card on phones. The first column is the card's
 * title (the ticker or date), the first non-numeric column after it is the subtitle (company name),
 * and every remaining column becomes a label/value pair.
 */
export type CardColumn = { id: string; numeric?: boolean };
export type CardLayout = { title: string | null; subtitle: string | null; fields: string[] };

export function cardLayout(columns: readonly CardColumn[], options: { maxFields?: number } = {}): CardLayout {
  const [first, ...rest] = columns;
  if (!first) return { title: null, subtitle: null, fields: [] };
  const subtitleIndex = rest.findIndex((column) => !column.numeric);
  const subtitle = subtitleIndex >= 0 && !first.numeric ? rest[subtitleIndex] : undefined;
  const fields = rest.filter((column) => column !== subtitle).map((column) => column.id);
  return { title: first.id, subtitle: subtitle?.id ?? null, fields: options.maxFields === undefined ? fields : fields.slice(0, options.maxFields) };
}

/** How many cards to render before "show more": a phone does not need 500 DOM rows. */
export const CARD_PAGE = 30;

export function visibleCards(total: number, pages: number): number {
  return Math.min(total, CARD_PAGE * Math.max(1, pages));
}
