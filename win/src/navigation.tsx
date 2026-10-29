import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

// The Rhythm website's navigation (mobile/src/app/(app)/(tabs)/_layout.web.tsx): Overview, Coach, Calendar and
// Camera workout; Content library and Interests & sharing under Discover; Downloads and Profile at the bottom. Each
// section keeps its own stack of pages, like a tab's native stack on iOS. The recipe and workout libraries are
// sections reached from Calendar, as on the website.

export type Section =
  | 'overview'
  | 'coach'
  | 'calendar'
  | 'camera'
  | 'library'
  | 'interests'
  | 'downloads'
  | 'profile'
  | 'meals'
  | 'activity';

export type Route =
  | { name: 'root' }
  | { name: 'recipe'; id: string }
  | { name: 'shopping' }
  | { name: 'routine'; id: string }
  | { name: 'session'; id: string }
  | { name: 'memory' }
  | { name: 'connections' }
  | { name: 'edit-profile' }
  | { name: 'account' };

export type NavGroup = 'main' | 'discover' | 'bottom';

export const SECTIONS: {
  key: Section;
  label: string;
  group: NavGroup;
  /** A glyph of Windows' own icon font (Segoe MDL2 Assets), standing in for the website's Material Symbol; the Coach
   * has the AI orb instead. */
  glyph: string;
  ai?: boolean;
}[] = [
  { key: 'overview', label: 'Overview', group: 'main', glyph: '' },
  { key: 'coach', label: 'Coach', group: 'main', glyph: '', ai: true },
  { key: 'calendar', label: 'Calendar', group: 'main', glyph: '' },
  { key: 'camera', label: 'Camera workout', group: 'main', glyph: '' },
  { key: 'library', label: 'Content library', group: 'discover', glyph: '' },
  { key: 'interests', label: 'Interests & sharing', group: 'discover', glyph: '' },
  { key: 'downloads', label: 'Downloads', group: 'bottom', glyph: '' },
  { key: 'profile', label: 'Profile', group: 'bottom', glyph: '' },
];

/** The sidebar item a section belongs to (the recipe and workout libraries open from Calendar). */
export function navItemOf(section: Section): Section {
  return section === 'meals' || section === 'activity' ? 'calendar' : section;
}

const ROUTE_TITLES: Record<Exclude<Route['name'], 'root'>, string> = {
  recipe: 'Recipe',
  shopping: 'Shopping list',
  routine: 'Routine',
  session: 'Session',
  memory: 'Memory',
  connections: 'AI connections',
  'edit-profile': 'Preferences & goals',
  account: 'Rhythm account',
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
  const [section, setSection] = useState<Section>('overview');
  const [stacks, setStacks] = useState<Record<Section, Route[]>>({
    overview: ROOT,
    coach: ROOT,
    calendar: ROOT,
    camera: ROOT,
    library: ROOT,
    interests: ROOT,
    downloads: ROOT,
    profile: ROOT,
    meals: ROOT,
    activity: ROOT,
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
