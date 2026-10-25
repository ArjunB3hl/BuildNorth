import type { ReactNode } from 'react';

/** The panel's shared pieces, drawn to match the Rhythm web app (colours and sizes live in style.css). */

// Material Symbols paths (24 × 24), the same icon family the web app uses.
const paths = {
  sparkle: 'M19 9l1.25-2.75L23 5l-2.75-1.25L19 1l-1.25 2.75L15 5l2.75 1.25L19 9zm-7.5.5L9 4 6.5 9.5 1 12l5.5 2.5L9 20l2.5-5.5L17 12l-5.5-2.5zM19 15l-1.25 2.75L15 19l2.75 1.25L19 23l1.25-2.75L23 19l-2.75-1.25L19 15z',
  bookmark: 'M17 3H7c-1.1 0-1.99.9-1.99 2L5 21l7-3 7 3V5c0-1.1-.9-2-2-2z',
  shield: 'M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4zm-2 16l-4-4 1.41-1.41L10 14.17l6.59-6.59L18 9l-8 8z',
  search: 'M15.5 14h-.79l-.28-.27C15.41 12.59 16 11.11 16 9.5 16 5.91 13.09 3 9.5 3S3 5.91 3 9.5 5.91 16 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z',
  agent: 'M20 9V7c0-1.1-.9-2-2-2h-3c0-1.66-1.34-3-3-3S9 3.34 9 5H6c-1.1 0-2 .9-2 2v2c-1.66 0-3 1.34-3 3s1.34 3 3 3v4c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2v-4c1.66 0 3-1.34 3-3s-1.34-3-3-3zm-2 10H6V7h12v12zm-9-6c-.83 0-1.5-.67-1.5-1.5S8.17 10 9 10s1.5.67 1.5 1.5S9.83 13 9 13zm7.5-1.5c0 .83-.67 1.5-1.5 1.5s-1.5-.67-1.5-1.5S14.17 10 15 10s1.5.67 1.5 1.5zM8 15h8v2H8v-2z',
  task: 'M19 3h-4.18C14.4 1.84 13.3 1 12 1c-1.3 0-2.4.84-2.82 2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-7 0c.55 0 1 .45 1 1s-.45 1-1 1-1-.45-1-1 .45-1 1-1zm2 14H7v-2h7v2zm3-4H7v-2h10v2zm0-4H7V7h10v2z',
} as const;
export type IconName = keyof typeof paths;

export function Icon({ name }: { name: IconName }) {
  return <svg className="icon" viewBox="0 0 24 24" aria-hidden="true"><path d={paths[name]} fill="currentColor" /></svg>;
}

/** The AI's mark, as in the web app: a slowly turning violet-to-cyan orb with a sparkle. `still` stops it turning. */
export function Orb({ size = 32, still = false }: { size?: number; still?: boolean }) {
  return <span className={still ? 'orb still' : 'orb'} style={{ width: size, height: size }} aria-hidden="true">
    <Icon name="sparkle" />
  </span>;
}

/** The app name with the orb, for the header and the sign-in screens. */
export function Brand({ size = 28 }: { size?: number }) {
  return <div className="brand">
    <Orb size={size} />
    <div><h1>Rhythm</h1><span className="demo-label">Demo version</span></div>
  </div>;
}

/** A card's heading: an icon tile (or the orb), its title and a short description, like the web app's SectionCard. */
export function CardHead({ icon, leading, title, description, id }: {
  icon?: IconName; leading?: ReactNode; title: ReactNode; description?: ReactNode; id?: string;
}) {
  return <div className="card-head">
    {leading ?? (icon && <span className="tile"><Icon name={icon} /></span>)}
    <div>
      <h2 id={id}>{title}</h2>
      {description && <p>{description}</p>}
    </div>
  </div>;
}

/** A page decision as a pill: its words and colour. */
export const relevanceBadge = {
  relevant: { label: 'Matches your interests', tone: 'success' },
  uncertain: { label: 'Not enough information', tone: 'warning' },
  irrelevant: { label: 'Outside your interests', tone: 'muted' },
} as const;

/** An uppercase label above a group of cards, like the web app's SectionHeader. */
export function SectionLabel({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return <div className="section-label"><h2>{children}</h2>{action}</div>;
}
