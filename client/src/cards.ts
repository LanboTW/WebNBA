import {
  RENTAL_COLOR,
  cardPlayer,
  cardTeam,
  headshotId,
  isRental,
  specialTheme,
  tier,
  tierIndex,
  topRatings,
  type OwnedCard,
} from '@webnba/shared';
import { esc } from './boxscore';
import { RATING_LABEL } from './careerCreate';
import { logoHtml } from './logos';
import { portrait } from './portrait';

/**
 * A MyTeam card face: photo (or drawn portrait), overall, position, team
 * logo, three best ratings and where the card is from, in its tier's frame
 * (special cards in their theme's colours, rentals in grey). Pink and up
 * shimmer; black cards give off sparks; merged copies show +N.
 */

/** Pink and better (rentals never). */
export const shiny = (c: OwnedCard) => !isRental(c) && tierIndex(c.tier) >= tierIndex('pink');

/** The picture: a special card's own, else the player's headshot (none: a drawn portrait later). */
function photoSrc(c: OwnedCard): string {
  if (c.image) return `${import.meta.env.BASE_URL}cards/${c.image}`;
  const id = headshotId(c.name);
  return id ? `${import.meta.env.BASE_URL}headshots/${id}.png` : '';
}

export function cardHtml(c: OwnedCard, opts: { cls?: string; ref?: string; note?: string; count?: number } = {}): string {
  const t = tier(c.tier);
  const team = cardTeam(c);
  const src = photoSrc(c);
  const rent = isRental(c);
  const theme = specialTheme(c.theme);
  const stats = topRatings(c)
    .map((r) => `<span><b>${r.value}</b>${RATING_LABEL[r.key]}</span>`)
    .join('');
  const rental = isRental(c) ? `<em class="rent">租借・剩 ${c.games} 場</em>` : '';
  const sparks = c.tier === 'black' && !rent ? `<i class="sparks">${'<i></i>'.repeat(8)}</i>` : '';
  const plus = c.plus ? `<em class="plus">+${c.plus}<i>${'★'.repeat(c.plus)}</i></em>` : '';
  const count = (opts.count ?? 1) > 1 ? `<em class="count">×${opts.count}</em>` : '';
  const tierText = rent ? '租借卡' : `${t.name}卡`;
  const cls = ['mtcard', rent ? 't-rental' : `t-${c.tier}`, shiny(c) ? 'shiny' : '', rent ? 'rental' : '', theme && !rent ? 'themed' : '', opts.cls ?? '']
    .filter(Boolean)
    .join(' ');
  const style = rent ? `--tier:${RENTAL_COLOR}` : theme ? `--tier:${theme.color};--accent2:${theme.accent}` : `--tier:${t.color}`;
  return (
    `<div class="${cls}" style="${style}" ${opts.ref ? `data-ref="${esc(opts.ref)}"` : ''}>` +
    `<div class="mtc-in">` +
    `<div class="mtc-top"><b class="ovr">${c.ovr}</b><span class="pos">${c.position}</span>${logoHtml(team, 'mtc-logo')}</div>` +
    `<div class="mtc-photo${c.image ? ' art' : ''}"><img class="mtc-img" alt="" data-name="${esc(c.name)}" data-team="${esc(c.team)}"${src ? ` src="${src}"` : ''} /></div>` +
    `<div class="mtc-name">${esc(c.name)}</div>` +
    `<div class="mtc-stats">${stats}</div>` +
    `<div class="mtc-tier"><span>${tierText}</span>${c.label ? `<span class="lbl">${esc(c.label)}</span>` : ''}</div>` +
    plus +
    count +
    rental +
    (opts.note ? `<em class="note">${opts.note}</em>` : '') +
    `</div>${sparks}</div>`
  );
}

/** Fills in portraits for cards without a photo (or whose photo fails). Call after inserting cards. */
export function hydrateCards(root: HTMLElement, cards: OwnedCard[]): void {
  const byName = new Map(cards.map((c) => [c.name, c]));
  root.querySelectorAll<HTMLImageElement>('img.mtc-img').forEach((img) => {
    const c = byName.get(img.dataset.name ?? '');
    if (!c) return;
    const fallback = () => {
      img.removeAttribute('src');
      void portrait(cardPlayer(c), cardTeam(c)).then((url) => {
        if (url) {
          img.src = url;
          img.classList.add('drawn');
        }
      });
    };
    if (!img.getAttribute('src')) fallback();
    else img.addEventListener('error', fallback, { once: true });
  });
}
