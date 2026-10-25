import type { SymbolViewProps } from 'expo-symbols';

type IconName = SymbolViewProps['name'];

/** SF Symbols on iOS, Material Symbols on Android and the web. */
export const MealIcons = {
  recipe: { ios: 'fork.knife', android: 'restaurant', web: 'restaurant' },
  servings: { ios: 'person.2', android: 'group', web: 'group' },
  ingredients: { ios: 'list.bullet', android: 'format_list_bulleted', web: 'format_list_bulleted' },
  steps: { ios: 'list.number', android: 'format_list_numbered', web: 'format_list_numbered' },
  timer: { ios: 'timer', android: 'timer', web: 'timer' },
  cart: { ios: 'cart', android: 'shopping_cart', web: 'shopping_cart' },
  addToCart: { ios: 'cart.badge.plus', android: 'add_shopping_cart', web: 'add_shopping_cart' },
  add: { ios: 'plus', android: 'add', web: 'add' },
  cook: { ios: 'frying.pan', android: 'skillet', web: 'skillet' },
  plan: { ios: 'calendar.badge.plus', android: 'calendar_add_on', web: 'calendar_add_on' },
  edit: { ios: 'pencil', android: 'edit', web: 'edit' },
  delete: { ios: 'trash', android: 'delete', web: 'delete' },
  check: { ios: 'checkmark', android: 'check', web: 'check' },
  close: { ios: 'xmark', android: 'close', web: 'close' },
  up: { ios: 'arrow.up', android: 'arrow_upward', web: 'arrow_upward' },
  down: { ios: 'arrow.down', android: 'arrow_downward', web: 'arrow_downward' },
  back: { ios: 'arrow.left', android: 'arrow_back', web: 'arrow_back' },
  search: { ios: 'magnifyingglass', android: 'search', web: 'search' },
  paste: { ios: 'doc.on.clipboard', android: 'content_paste', web: 'content_paste' },
  write: { ios: 'square.and.pencil', android: 'edit_note', web: 'edit_note' },
  nutrition: { ios: 'leaf', android: 'eco', web: 'eco' },
  notes: { ios: 'note.text', android: 'notes', web: 'notes' },
  clear: { ios: 'trash', android: 'delete_sweep', web: 'delete_sweep' },
} as const satisfies Record<string, IconName>;
