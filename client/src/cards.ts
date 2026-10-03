import {
  cardPlayer,
  cardTeam,
  headshotId,
  isRental,
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
 * logo, three best ratings, in its tier's frame. Pink and up shimmer; black
 * cards give off sparks.
 */

/** Pink and better. */
export const shiny = (c: OwnedCard) => tierIndex(c.tier) >= tierIndex('pink');

export function cardHtml(c: OwnedCard, opts: { cls?: string; ref?: string; note?: string } = {}): string {
  const t = tier(c.tier);
  const team = cardTeam(c);
  const id = headshotId(c.name);
  const src = id ? `${import.meta.env.BASE_URL}headshots/${id}.png` : '';
  const stats = topRatings(c)
    .map((r) => `<span><b>${r.value}</b>${RATING_LABEL[r.key]}</span>`)
    .join('');
  const rental = isRental(c) ? `<em class="rent">租借・剩 ${c.games} 場</em>` : '';
  const sparks = c.tier === 'black' ? `<i class="sparks">${'<i></i>'.repeat(8)}</i>` : '';
  const cls = ['mtcard', `t-${c.tier}`, shiny(c) ? 'shiny' : '', isRental(c) ? 'rental' : '', opts.cls ?? ''].filter(Boolean).join(' ');
  return (
    `<div class="${cls}" style="--tier:${t.color}" ${opts.ref ? `data-ref="${esc(opts.ref)}"` : ''}>` +
    `<div class="mtc-in">` +
    `<div class="mtc-top"><b class="ovr">${c.ovr}</b><span class="pos">${c.position}</span>${logoHtml(team, 'mtc-logo')}</div>` +
    `<div class="mtc-photo"><img class="mtc-img" alt="" data-name="${esc(c.name)}" data-team="${esc(c.team)}"${src ? ` src="${src}"` : ''} /></div>` +
    `<div class="mtc-name">${esc(c.name)}</div>` +
    `<div class="mtc-stats">${stats}</div>` +
    `<div class="mtc-tier">${t.name}卡${c.base ? '' : '・強化'}</div>` +
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
