// Épopée Sport — logique de comptage des répétitions (indépendante de la caméra, testable)
// Points MediaPipe Pose : 0 nez, 11/12 épaules, 13/14 coudes, 15/16 poignets,
// 23/24 hanches, 25/26 genoux, 27/28 chevilles. Gauche = côté gauche de la personne.

export const EXERCISES = {
  pompes: { n: 'Pompes', i: '💪', tip: 'Pose le téléphone au sol, de profil, à 2 m. Tout ton corps doit être visible.' },
  abdos: { n: 'Abdos', i: '🔥', tip: 'Allonge-toi de profil, genoux pliés. Remonte le buste jusqu’aux genoux.' },
  squats: { n: 'Squats', i: '🦵', tip: 'Recule pour que la caméra te voie de la tête aux pieds, de face ou de profil.' }
};

const SIDE = { L: { s: 11, e: 13, w: 15, h: 23, k: 25, a: 27 }, R: { s: 12, e: 14, w: 16, h: 24, k: 26, a: 28 } };
const vis = (p) => (p && (p.visibility ?? 1)) || 0;

export function angle(a, b, c, aspect = 1) {
  const abx = (a.x - b.x) * aspect, aby = a.y - b.y;
  const cbx = (c.x - b.x) * aspect, cby = c.y - b.y;
  const dot = abx * cbx + aby * cby;
  const m = Math.hypot(abx, aby) * Math.hypot(cbx, cby);
  if (!m) return 180;
  return Math.acos(Math.max(-1, Math.min(1, dot / m))) * 180 / Math.PI;
}
// inclinaison d’un segment par rapport à l’horizontale, 0..90°
export function tilt(a, b, aspect = 1) {
  const dx = Math.abs((b.x - a.x) * aspect), dy = Math.abs(b.y - a.y);
  return Math.atan2(dy, dx) * 180 / Math.PI;
}
function bestSide(lm, keys) {
  const sc = (S) => keys.reduce((t, k) => t + vis(lm[S[k]]), 0);
  return sc(SIDE.L) >= sc(SIDE.R) ? SIDE.L : SIDE.R;
}
const MIN_VIS = 0.5;

export class RepCounter {
  constructor(type, opts = {}) {
    this.type = type;
    this.count = 0;
    this.partial = 0;
    this.phase = 'haut';        // 'haut' | 'bas'
    this.minAng = 999;          // angle minimum atteint pendant le cycle en cours
    this.downAt = 0;
    this.lastRep = -1e9;
    this.minRepMs = opts.minRepMs ?? 700;   // anti-triche : pas plus vite qu’une rep / 0,7 s
    this.minDownMs = opts.minDownMs ?? 150;
    this.lostSince = null;
  }
  reset() { this.phase = 'haut'; this.minAng = 999; }

  // lm : tableau de 33 points {x,y,visibility}; t : ms; aspect = largeur/hauteur de l’image
  update(lm, t, aspect = 1) {
    const r = { count: this.count, ok: false, msg: '', valid: false, angle: null, progress: 0, event: null };
    if (!lm || lm.length < 29) return this.lost(r, t, 'Je ne te vois pas. Mets-toi face à la caméra.');
    const f = this['u_' + this.type];
    return f.call(this, lm, t, aspect, r);
  }
  lost(r, t, msg) {
    if (this.lostSince === null) this.lostSince = t;
    if (t - this.lostSince > 600) this.reset();     // on ne compte pas une rep « à travers » une coupure
    r.msg = msg; r.count = this.count; return r;
  }
  seen() { this.lostSince = null; }

  // cœur commun : angle qui descend sous `low` puis remonte au-dessus de `high`
  cycle(a, t, r, low, high, okPose, partialMsg) {
    r.angle = Math.round(a);
    r.progress = Math.max(0, Math.min(1, (high - a) / (high - low)));
    if (this.phase === 'haut') {
      if (a < high - 10) this.minAng = Math.min(this.minAng, a);
      if (a < low && okPose) { this.phase = 'bas'; this.downAt = t; }
      else if (a >= high && this.minAng < high - 25) { // remonté sans être descendu assez bas
        this.partial++; r.event = 'partielle'; r.msg = partialMsg; this.minAng = 999;
      } else if (a >= high) { this.minAng = 999; }
    } else {
      if (a >= high) {
        const okTime = t - this.downAt >= this.minDownMs && t - this.lastRep >= this.minRepMs;
        if (okTime) { this.count++; this.lastRep = t; r.event = 'rep'; }
        else { r.event = 'tropvite'; r.msg = 'Trop rapide : fais des répétitions complètes.'; }
        this.phase = 'haut'; this.minAng = 999;
      }
    }
    r.count = this.count; return r;
  }

  u_pompes(lm, t, asp, r) {
    const S = bestSide(lm, ['s', 'e', 'w', 'h']);
    const s = lm[S.s], e = lm[S.e], w = lm[S.w], h = lm[S.h];
    const foot = vis(lm[S.a]) >= 0.4 ? lm[S.a] : lm[S.k];
    if ([s, e, w, h].some(p => vis(p) < MIN_VIS) || vis(foot) < 0.3)
      return this.lost(r, t, 'Recule : épaule, coude, poignet, hanche et jambes doivent être visibles.');
    this.seen();
    const elbow = angle(s, e, w, asp);
    const body = angle(s, h, foot, asp);
    const horiz = tilt(s, h, asp) < 40;
    const straight = body > 145;
    const okPose = horiz && straight;
    r.valid = okPose;
    if (!horiz) r.msg = 'Mets-toi en position de pompe, de profil face à la caméra.';
    else if (!straight) r.msg = 'Garde le corps bien droit, des épaules aux pieds.';
    else r.ok = true;
    return this.cycle(elbow, t, r, 95, 150, okPose, 'Pas assez bas ! Descends la poitrine près du sol.');
  }
  u_abdos(lm, t, asp, r) {
    const S = bestSide(lm, ['s', 'h', 'k']);
    const s = lm[S.s], h = lm[S.h], k = lm[S.k], a = lm[S.a];
    if ([s, h, k].some(p => vis(p) < MIN_VIS))
      return this.lost(r, t, 'Mets-toi de profil : épaule, hanche et genou doivent être visibles.');
    this.seen();
    const hip = angle(s, h, k, asp);
    const kneeBent = vis(a) < 0.3 || angle(h, k, a, asp) < 135;
    const lyingWhenOpen = hip < 120 || tilt(s, h, asp) < 35;
    const okPose = kneeBent;
    r.valid = okPose && lyingWhenOpen;
    if (!kneeBent) r.msg = 'Plie les genoux, pieds au sol.';
    else if (!lyingWhenOpen) r.msg = 'Allonge-toi sur le dos entre chaque répétition.';
    else r.ok = true;
    // ici « haut » = allongé (angle ouvert), « bas » = buste remonté (angle fermé)
    if (this.phase === 'haut' && hip >= 110 && !lyingWhenOpen) { r.count = this.count; r.angle = Math.round(hip); return r; }
    return this.cycle(hip, t, r, 70, 110, okPose, 'Remonte plus haut : le buste doit aller vers les genoux.');
  }
  u_squats(lm, t, asp, r) {
    const ks = [SIDE.L, SIDE.R].filter(S => vis(lm[S.h]) >= MIN_VIS && vis(lm[S.k]) >= MIN_VIS && vis(lm[S.a]) >= 0.4);
    if (!ks.length || vis(lm[11]) + vis(lm[12]) < 0.8)
      return this.lost(r, t, 'Recule : je dois te voir de la tête aux pieds.');
    this.seen();
    const knee = ks.reduce((s, S) => s + angle(lm[S.h], lm[S.k], lm[S.a], asp), 0) / ks.length;
    const S = ks[0];
    const upright = tilt(lm[S.s], lm[S.h], asp) > 40;
    r.valid = upright;
    if (!upright) r.msg = 'Garde le buste plus droit.'; else r.ok = true;
    return this.cycle(knee, t, r, 100, 160, upright, 'Plus bas ! Les cuisses doivent arriver presque à l’horizontale.');
  }
}

// Défi de présence : la personne doit lever une main précise (preuve que c’est bien du direct)
export const CHALLENGES = [
  { k: 'droite', n: 'Lève la main DROITE au-dessus de ta tête' },
  { k: 'gauche', n: 'Lève la main GAUCHE au-dessus de ta tête' },
  { k: 'deux', n: 'Lève les DEUX mains au-dessus de ta tête' }
];
export function challengeOk(k, lm) {
  if (!lm || !lm[0]) return false;
  const nose = lm[0], up = (w) => vis(w) > 0.5 && w.y < nose.y - 0.05;
  const L = up(lm[15]), R = up(lm[16]);
  if (k === 'deux') return L && R;
  if (k === 'gauche') return L && !R;
  return R && !L;
}

export async function dayCode(pin, dateKey) {
  const data = new TextEncoder().encode(String(pin).trim() + '|' + dateKey);
  const buf = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 6).toUpperCase();
}
