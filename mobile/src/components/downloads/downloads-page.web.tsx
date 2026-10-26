import { Link } from 'expo-router';
import Head from 'expo-router/head';
import type { CSSProperties, ReactNode } from 'react';
import { Wordmark } from '@/components/wordmark';
import { useDownloadDevice } from '@/hooks/use-download-device';
import { useTheme } from '@/hooks/use-theme';
import { DEMO_RELEASE_URL, demoDownloads, demoDownloadUrl, downloadSize, type DemoDownload, type DemoDownloadId } from '@/lib/demo-downloads';
import type { DownloadDevice } from '@/lib/device-download';
import s from './downloads-page.module.css';

type IconName = DemoDownloadId | 'download' | 'arrow' | 'calendar' | 'spark' | 'web';

function Icon({ name, className }: { name: IconName; className?: string }) {
  const paths: Record<IconName, ReactNode> = {
    chrome: <><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="3.5" /><path d="m4.2 7.5 4.8 8M12 3h8M12 15.5 8 20" /></>,
    mac: <><rect x="3" y="4" width="18" height="12" rx="2" /><path d="M8 21h8m-4-5v5" /></>,
    android: <><rect x="6" y="3" width="12" height="18" rx="3" /><path d="M10 17h4M10 6h4" /></>,
    ios: <><rect x="6" y="2" width="12" height="20" rx="3" /><path d="M10 5h4m-3 14h2" /></>,
    watchos: <><rect x="6" y="6" width="12" height="12" rx="4" /><path d="M9 6V2h6v4M9 18v4h6v-4m-3-9v3l2 1" /></>,
    download: <><path d="M12 3v12m-5-5 5 5 5-5M4 16v4h16v-4" /></>,
    arrow: <><path d="M5 12h14m-6-6 6 6-6 6" /></>,
    calendar: <><rect x="3" y="5" width="18" height="16" rx="3" /><path d="M7 3v4m10-4v4M3 11h18m-13 4h2m4 0h2" /></>,
    spark: <><path d="m12 3 2.4 6.6L21 12l-6.6 2.4L12 21l-2.4-6.6L3 12l6.6-2.4L12 3Z" /></>,
    windows: <><path d="m3 5 8-1v7H3V5Zm10-1 8-1v8h-8V4ZM3 13h8v7l-8-1v-6Zm10 0h8v8l-8-1v-7Z" /></>,
    web: <><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3c2.4 2.5 3.6 5.5 3.6 9s-1.2 6.5-3.6 9c-2.4-2.5-3.6-5.5-3.6-9S9.6 5.5 12 3Z" /></>,
  };
  return <svg className={className} width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}

const deviceHints: Record<DownloadDevice, string> = {
  mac: 'Detected: Mac. The Mac app is for Apple silicon. You can also use the Chrome extension or stay on the website.',
  android: 'Detected: Android. Use the ARM64 APK on a compatible device, or keep using Rhythm in your browser.',
  iphone: 'Detected: iPhone or iPad. Use Rhythm in your browser. The simulator downloads below run on a Mac, not on your phone.',
  windows: 'Detected: Windows. Try the Windows test build on an x64 PC, or use the website with the Chrome extension.',
  other: 'Pick your platform below, or open Rhythm on the website. The browser works without installing an app.',
};

function DownloadCard({ item, recommended }: { item: DemoDownload; recommended: boolean }) {
  const simulator = item.id === 'ios' || item.id === 'watchos';
  return <article className={`${s.card} ${item.id === 'chrome' ? s.featured : ''} ${recommended ? s.recommended : ''}`} aria-labelledby={`title-${item.id}`}>
    <div className={s.cardMain}>
      <div className={s.cardTop}>
        <span className={s.iconTile}><Icon name={item.id} /></span>
        {simulator ? <span className={s.tag}>Simulator only</span> : recommended ? <span className={s.blueTag}>Your platform</span> : item.id === 'chrome' ? <span className={s.blueTag}>Start with a video</span> : null}
      </div>
      <h3 id={`title-${item.id}`}>{item.title}</h3>
      <p className={s.description}>{item.description}</p>
      <p className={s.compatibility}>{item.compatibility}</p>
      <div className={s.downloadRow}>
        <a className={s.downloadButton} href={demoDownloadUrl(item)} download={item.filename} aria-describedby={`note-${item.id}`}>
          <Icon name="download" />{item.label}
        </a>
        <span className={s.fileMeta}>{item.format} · {downloadSize(item.bytes)}</span>
      </div>
    </div>
    <div className={s.cardDetails}>
      <p className={s.note} id={`note-${item.id}`}>{item.note}</p>
      <details className={s.install}>
        <summary>How to install <span aria-hidden="true">+</span></summary>
        <ol>{item.steps.map(step => <li key={step}>{step}</li>)}</ol>
      </details>
    </div>
  </article>;
}

export default function DownloadsPage() {
  const theme = useTheme();
  const device = useDownloadDevice();
  const colors = {
    '--download-bg': theme.background,
    '--download-surface': theme.backgroundElement,
    '--download-raised': theme.backgroundSelected,
    '--download-text': theme.text,
    '--download-muted': theme.textSecondary,
    '--download-border': theme.border,
  } as CSSProperties;
  return <div className={s.page} style={colors}>
    <Head><title>Download Rhythm · Demo version</title><meta name="description" content="Try Rhythm on the web, Mac, Windows and Android. Download the Chrome extension and explore iPhone and Apple Watch simulator demos." /></Head>
    <a className={s.skip} href="#download-options">Skip to downloads</a>
    <header className={s.header}>
      <Link href="/" asChild><a className={s.brand} aria-label="Rhythm home"><Wordmark /></a></Link>
      <Link href="/" asChild><a className={s.headerLink}>Open website <Icon name="arrow" /></a></Link>
    </header>
    <main className={s.main}>
      <section className={s.hero} aria-labelledby="downloads-title">
        <div className={s.heroCopy}>
          <p className={s.eyebrow}><span /> READY TO TRY</p>
          <h1 id="downloads-title">Your day.<br /><span>A little more Rhythm.</span></h1>
          <p className={s.heroDescription}>Meals, movement and the ideas worth keeping. Find your space to bring them together, on the web or in an app.</p>
          <div className={s.heroActions}>
            <a className={s.primaryButton} href="#download-options">Explore downloads <Icon name="arrow" /></a>
            <Link href="/" asChild><a className={s.secondaryButton}>Use the website</a></Link>
          </div>
          <p className={s.heroFootnote}>No sign-in needed to download. Demo version · October 25, 2026.</p>
        </div>
        <div className={s.heroVisual} aria-hidden="true">
          <div className={s.orbit} /><div className={s.orbitInner} />
          <div className={s.centerMark}><Icon name="spark" /></div>
          <div className={`${s.floatingCard} ${s.ideaCard}`}><span className={s.miniIcon}><Icon name="chrome" /></span><div><strong>Save an idea</strong><span>A recipe worth trying</span></div></div>
          <div className={`${s.floatingCard} ${s.dayCard}`}><span className={s.miniIcon}><Icon name="calendar" /></span><div><strong>Plan your day</strong><span>Make room for yourself</span></div></div>
          <div className={`${s.floatingCard} ${s.rhythmCard}`}><span className={s.miniIcon}><Icon name="spark" /></span><div><strong>Find your rhythm</strong><span>One small step at a time</span></div></div>
        </div>
      </section>
      <div className={s.deviceHint}><Icon name={device === 'mac' ? 'mac' : device === 'android' ? 'android' : device === 'iphone' ? 'ios' : device === 'windows' ? 'windows' : 'spark'} /><p>{deviceHints[device]}</p></div>
      <section className={s.section} id="download-options" aria-labelledby="apps-title">
        <div className={s.sectionHeading}><div><p className={s.eyebrow}>MAKE IT YOURS</p><h2 id="apps-title">Apps & browser extension</h2></div><p>Choose how Rhythm fits into your day.</p></div>
        <div className={`${s.grid} ${s.appsGrid}`}>{demoDownloads.filter(item => item.id !== 'ios' && item.id !== 'watchos').map(item => <DownloadCard key={item.id} item={item} recommended={item.id === device} />)}</div>
      </section>
      <section className={s.section} aria-labelledby="simulators-title">
        <div className={s.sectionHeading}><div><p className={s.eyebrow}>FOR EXPLORING IN XCODE</p><h2 id="simulators-title">A preview on your Mac</h2></div><p>These packages run in simulators. They do not install on a physical iPhone or Apple Watch.</p></div>
        <div className={s.grid}>{demoDownloads.filter(item => item.id === 'ios' || item.id === 'watchos').map(item => <DownloadCard key={item.id} item={item} recommended={false} />)}</div>
      </section>
      <section className={s.browserCard} aria-labelledby="browser-title">
        <span className={s.iconTile}><Icon name="web" /></span>
        <div><h2 id="browser-title">Prefer not to install anything? You’re already in the right place.</h2><p>Rhythm works on the website in your browser, with the Chrome extension if you like.</p></div>
        <Link href="/" asChild><a className={s.secondaryButton}>Open Rhythm <Icon name="arrow" /></a></Link>
      </section>
    </main>
    <footer className={s.footer}><p>Rhythm · Demo version <span>Built for a little everyday progress.</span></p><a href={`${DEMO_RELEASE_URL}/SHA256SUMS`} download="SHA256SUMS">Download file checksums <Icon name="arrow" /></a></footer>
  </div>;
}
