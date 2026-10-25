import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import type { ImageSourcePropType } from 'react-native';

// The iPhone app's five tabs become sidebar sections. Each section keeps its own
// stack, like a tab's native stack on iOS.

export type Section =
  | 'today'
  | 'coach'
  | 'calendar'
  | 'meals'
  | 'activity'
  | 'profile';

export type Route =
  | { name: 'root' }
  | { name: 'recipe'; id: string }
  | { name: 'shopping' }
  | { name: 'routine'; id: string }
  | { name: 'session'; id: string }
  | { name: 'memory' };

export const SECTIONS: {
  key: Section;
  label: string;
  /** SF Symbol drawn natively by the NorthMac Expo module (same names as the iPhone tabs). */
  symbol: string;
  /** PNG of the same symbol, for where NorthMac isn't built in (Jest, other platforms). */
  icon: ImageSourcePropType;
}[] = [
  {
    key: 'today',
    label: 'Today',
    symbol: 'sun.max',
    icon: require('./assets/icons/today.png'),
  },
  {
    key: 'coach',
    label: 'Coach',
    symbol: 'bubble.left.and.bubble.right',
    icon: require('./assets/icons/coach.png'),
  },
  {
    key: 'calendar',
    label: 'Calendar',
    symbol: 'calendar',
    icon: require('./assets/icons/today.png'),
  },
  {
    key: 'profile',
    label: 'Profile',
    symbol: 'person.crop.circle',
    icon: require('./assets/icons/profile.png'),
  },
];

const ROUTE_TITLES: Record<Exclude<Route['name'], 'root'>, string> = {
  recipe: 'Recipe',
  shopping: 'Shopping list',
  routine: 'Routine',
  session: 'Session',
  memory: 'Memory',
};

function routeTitle(section: Section, route: Route): string {
  if (route.name === 'root') {
    return (
      SECTIONS.find(s => s.key === section)?.label ??
      (section === 'meals' ? 'Recipes' : 'Workouts')
    );
  }
  return ROUTE_TITLES[route.name];
}

type Nav = {
  section: Section;
  route: Route;
  /** Title of the page underneath, shown as the back link; null at a section's root. */
  backTitle: string | null;
  /** Switch section; with a route, open that page on top of the section's root. */
  go: (section: Section, route?: Route) => void;
  push: (route: Route) => void;
  back: () => void;
};

const NavContext = createContext<Nav | null>(null);

const ROOT: Route[] = [{ name: 'root' }];

export function NavigationProvider({ children }: { children: ReactNode }) {
  const [section, setSection] = useState<Section>('today');
  const [stacks, setStacks] = useState<Record<Section, Route[]>>({
    calendar: ROOT,
    today: ROOT,
    coach: ROOT,
    meals: ROOT,
    activity: ROOT,
    profile: ROOT,
  });

  const stack = stacks[section];
  const go = useCallback(
    (next: Section, route?: Route) => {
      // Clicking the current section again returns to its root, like re-tapping a tab.
      if (route || next === section) {
        setStacks(s => ({ ...s, [next]: route ? [...ROOT, route] : ROOT }));
      }
      setSection(next);
    },
    [section],
  );
  const push = useCallback(
    (route: Route) =>
      setStacks(s => ({ ...s, [section]: [...s[section], route] })),
    [section],
  );
  const back = useCallback(
    () =>
      setStacks(s => ({
        ...s,
        [section]: s[section].length > 1 ? s[section].slice(0, -1) : ROOT,
      })),
    [section],
  );

  const value = useMemo<Nav>(
    () => ({
      section,
      route: stack[stack.length - 1],
      backTitle:
        stack.length > 1 ? routeTitle(section, stack[stack.length - 2]) : null,
      go,
      push,
      back,
    }),
    [section, stack, go, push, back],
  );
  return <NavContext.Provider value={value}>{children}</NavContext.Provider>;
}

export function useNav(): Nav {
  const nav = useContext(NavContext);
  if (!nav) {
    throw new Error('useNav must be used inside NavigationProvider');
  }
  return nav;
}
