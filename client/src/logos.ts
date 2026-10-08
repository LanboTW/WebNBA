import type { TeamInfo } from '@webnba/shared';

let official = true;

/** The "顯示官方隊徽" switch: off hides NBA logos; custom teams' own images still show. */
export function setOfficialLogos(on: boolean): void {
  official = on;
}

export function logoUrl(t: TeamInfo): string | null {
  if (!t.logo || (!t.group && !official)) return null;
  return `${import.meta.env.BASE_URL}logos/${t.logo}`;
}

/** An <img> for menus and the scoreboard; it removes itself if the file fails to load. */
export function logoHtml(t: TeamInfo, cls = 'logo'): string {
  const url = logoUrl(t);
  return url ? `<img class="${cls}" src="${encodeURI(url)}" alt="" onerror="this.remove()" />` : '';
}

const cache = new Map<string, Promise<HTMLImageElement | null>>();

/** Loads the logo for drawing onto a canvas; null when there is none or it fails. */
export function loadLogo(t: TeamInfo): Promise<HTMLImageElement | null> {
  const url = logoUrl(t);
  return url ? loadPicture(url) : Promise.resolve(null);
}

/** Any picture for drawing onto a canvas (cached); null when it fails. */
export function loadPicture(url: string): Promise<HTMLImageElement | null> {
  let p = cache.get(url);
  if (!p) {
    p = new Promise((resolve) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null);
      img.src = url;
    });
    cache.set(url, p);
  }
  return p;
}
