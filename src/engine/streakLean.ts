import { MAX_FIX_COLOURS } from './types'

/**
 * Streaks rebuilt small, for GPUs whose shader compiler cannot take the
 * full search (Windows: Chrome and Edge draw WebGL through Direct3D, whose
 * compiler took minutes on it, then crashed: a stack overflow, which more
 * than about one kind of streak's logic in one program still set off).
 *
 * Four small programs instead of one:
 * - table: each line's crossings of each streak's shape (the crossing
 *   table), so nothing searches along a line per pixel;
 * - trail and fill: one streak per draw, last to first, each over those
 *   after it where it covers the pixel (so the first that does is the one
 *   seen, as before): where the pixel's colour comes from, how much, how
 *   far along its bar, and where Repeat would read; into two float targets;
 * - colour: from those, the streak's tone (and its fixes'), Repeat's
 *   reads, and the colour, into the streak cache, which the look's own
 *   shader (built without streaks) reads.
 *
 * - lines (with skip): each line's colour and whether a mask holds it, for
 *   skipping masked colours (the full shader's line table);
 * - light: where a light held behind the streaks is read, past a trail's
 *   bar ends, into a target of its own for the colour draw.
 *
 * Left out, or simpler than the full shader: a fill does not hold back the
 * streaks after it inside its shape; colour fixes borrow and recolour in a
 * simpler way, line by line (leanStretch).
 */
export type LeanKind = 'table' | 'trail' | 'fill' | 'colour' | 'lines' | 'light'

/** Which version of a program: following drawn paths, skipping masked colours. */
export interface LeanVariant {
  path?: boolean
  skip?: boolean
}

/** A lean program's name, for a kind and variant. */
export function leanName(kind: LeanKind, v: LeanVariant = {}): string {
  return kind + (v.path ? '-path' : '') + (v.skip && (kind === 'trail' || kind === 'fill') ? '-skip' : '')
}

/**
 * A lean program's source. With path, its streaks' lines may follow a drawn
 * path (the full shader's coordinates, with their path search); without,
 * straight or through a vanishing point only, which most streaks are, and
 * the program stays small.
 */
export function leanStreakShader(full: string, kind: LeanKind, v: LeanVariant = {}): string {
  const at = full.indexOf('void main() {')
  if (at < 0) throw new Error('leanStreakShader: no main')
  let head = v.path ? '#define LEAN_PATH 1\n' : ''
  if (v.skip && (kind === 'trail' || kind === 'fill')) head += '#define LEAN_SKIP 1\n'
  if (kind === 'light') head += '#define LEAN_LIGHT 1\n'
  const body = kind === 'table' ? TABLE : kind === 'colour' ? COLOUR : kind === 'lines' ? LINES : GEOMETRY(kind === 'fill' ? 'fill' : 'trail')
  return full.slice(0, at) + head + COMMON + body
}

const COMMON = /* glsl */ `
uniform int uLeanStreak;

/** A streak's (s, t) at q, and back: straight or through a vanishing point, through the lens bend (no paths). */
vec2 leanCoords(int i, vec2 q) {
  q = bendUndo(i, q);
  vec2 dir = uStreakInfo[i].zw;
  vec4 v = uStreakVanish[i];
  if (v.w != 0.0) {
    vec2 e = v.w * dir;
    vec2 d = q - v.xy;
    return vec2(v.w * length(d), v.w * v.z * atan(cross2(e, d), dot(e, d)));
  }
  return vec2(dot(q, dir), dot(q, vec2(-dir.y, dir.x)));
}

vec2 leanPos(int i, vec2 st) {
  vec2 dir = uStreakInfo[i].zw;
  vec4 v = uStreakVanish[i];
  if (v.w != 0.0) {
    vec2 e = v.w * dir;
    float th = v.w * st.y / v.z;
    return bendDo(i, v.xy + v.w * st.x * (e * cos(th) + vec2(-e.y, e.x) * sin(th)));
  }
  return bendDo(i, dir * st.x + vec2(-dir.y, dir.x) * st.y);
}

#ifdef LEAN_PATH
#define LEAN_COORDS streakCoords
#define LEAN_POS streakPos
#else
#define LEAN_COORDS leanCoords
#define LEAN_POS leanPos
#endif

/**
 * Where on the photo a pixel sees, through the lens and the glass, as the
 * full shader's main does: not in the streaked photo for the wide passes
 * (uLinePass 2). split is the glass's colour fringe there.
 */
vec2 leanScene(vec2 printPx, out vec2 split) {
  split = vec2(0.0);
  vec2 lensPx = printPx;
  if (uLensK != 0.0 && uLinePass != 2) lensPx = lensScene(printPx);
  vec2 scenePx = lensPx;
  if (uGlass.x > 0.0 && uLinePass != 2) {
    float glassShade = 0.0;
    vec2 bent = glassAt(lensPx, split, glassShade);
    ivec2 gu = uSectionMask[6];
    if (uMaskCount > 0 && gu.y != 0) {
      vec3 seen = textureLod(uBase, clamp((lensPx - uImageOffset) / uBaseSize, vec2(0.0), vec2(1.0)), 0.0).rgb;
      vec2 gq = toShapeUnits(lensPx);
      float clear = 1.0;
      // Masks in a loop the compiler cannot count, read in one place (see maskAt).
      for (int m = 0; m < uMaskCount; m++) {
        if (((gu.x >> m) & 1) == 0) continue;
        float own;
        clear *= 1.0 - maskAt(m, gq, seen, 0.0, own);
      }
      float keepGlass = gu.y == 2 ? 1.0 - clear : clear;
      bent = mix(lensPx, bent, keepGlass);
      split *= keepGlass;
    }
    scenePx = bent;
  }
  return scenePx;
}
`

const TABLE = /* glsl */ `
void main() {
  ivec2 at = ivec2(gl_FragCoord.xy);
  int i = at.y / 4;
  int base = (at.y - i * 4) * 4;
  vec4 o = vec4(1e9);
  outUv = vec4(0.0);
  if (i >= uStreakCount) {
    outColor = o;
    return;
  }
  vec4 r = uCrossRange[i];
  float t = mix(r.z, r.w, float(at.x) / float(CROSS_LINES - 1));
  float ds = (r.y - r.x) / float(CROSS_STEPS);
  int n = 0;
  bool was = insideStreak(i, LEAN_POS(i, vec2(r.x, t)));
  if (was) {
    crossSet(o, -base, -1e6);
    n = 1;
  }
  // Counts the compiler cannot see (uStreakCount is never below 0): written
  // out step by step, Direct3D's compiler took 14 s over this; as loops, 0.2.
  int steps = CROSS_STEPS + min(uStreakCount, 0);
  int halvings = 8 + min(uStreakCount, 0);
  for (int k = 1; k <= steps; k++) {
    float s = r.x + ds * float(k);
    bool now = insideStreak(i, LEAN_POS(i, vec2(s, t)));
    if (now == was) continue;
    float lo = s - ds;
    float hi = s;
    for (int b = 0; b < halvings; b++) {
      float mid = 0.5 * (lo + hi);
      if (insideStreak(i, LEAN_POS(i, vec2(mid, t))) == was) lo = mid;
      else hi = mid;
    }
    crossSet(o, n - base, hi);
    n++;
    was = now;
  }
  if (was) crossSet(o, n - base, 1e6);
  outColor = o;
}
`

const LINES = /* glsl */ `
/**
 * The line table for skipping masked colours, as the full shader's
 * lineTablePass, with this program's coordinates and loop counts the
 * compiler cannot see: one texel per line across each shape, where the
 * line takes its colour and whether a mask holds that colour back.
 */
void main() {
  int i = int(gl_FragCoord.y);
  int k = int(gl_FragCoord.x);
  outUv = vec4(0.0);
  outColor = vec4(0.0);
  vec4 info = uLineInfo[i];
  if (i >= uStreakCount || float(k) >= info.z) return;
  float y = info.x + (float(k) + 0.5) * info.y;
  float span = uLineSpan[i];
  bool trail = uStreakExtra[i].w > 0.5;
  int steps = 384 + min(uStreakCount, 0);
  float stepLen = span / 384.0;
  float hit = -1.0;
  float prev = 0.0;
  for (int m = 0; m <= steps; m++) {
    float x = float(m) * stepLen;
    float s = trail ? info.w + span - x : info.w + x;
    if (insideStreak(i, LEAN_POS(i, vec2(s, y)))) {
      hit = x;
      break;
    }
    prev = x;
  }
  if (hit < 0.0) return;
  int halvings = 10 + min(uStreakCount, 0);
  for (int m = 0; m < halvings; m++) {
    float mid = 0.5 * (prev + hit);
    float s = trail ? info.w + span - mid : info.w + mid;
    if (insideStreak(i, LEAN_POS(i, vec2(s, y)))) hit = mid;
    else prev = mid;
  }
  float at = trail ? info.w + span - hit : info.w + prev;
  float pull = uStreakEdge[i].y;
  vec2 src = LEAN_POS(i, vec2(trail ? at - 0.002 - pull : at - pull, y));
  // A fill whose colour there is held back looks on back along its own
  // line, past the subject, for the first clear colour: clear there and a
  // little to either side, and a little further on if that is clear too.
  // Whether a place is held is asked at two places only (Direct3D's
  // compiler copies the mask test at each).
  float heldSrc = streakHeld(src);
  if (!trail && uStreakInfo[i].x > 0.5 && heldSrc > HELD_CLEAR) {
    int hidden = min(uStreakCount, 0);
    const float SIDE = 0.006;
    const float STEP = STREAK_MARCH / 48.0;
    for (int m = 1; m <= 48 + hidden; m++) {
      float back = at - float(m) * STEP;
      if (back < info.w) break;
      vec2 p = LEAN_POS(i, vec2(back - pull, y));
      vec2 puv = (fromShapeUnits(p) - uImageOffset) / uBaseSize;
      if (puv.x < 0.0 || puv.y < 0.0 || puv.x > 1.0 || puv.y > 1.0) break;
      float beyond = back - 4.0 * STEP;
      // 0: here; 1, 2: to either side; 3: a little further on.
      bool clear = true;
      bool on = beyond >= info.w;
      for (int k = 0; k < 4 + hidden; k++) {
        if (k == 3 && !on) break;
        vec2 pk = LEAN_POS(i, vec2((k == 3 ? beyond : back) - pull, k == 1 ? y - SIDE : k == 2 ? y + SIDE : y));
        bool held = streakHeld(pk) > HELD_CLEAR || ((k == 0 || k == 3) && keyedLikeSubject(pk));
        if (k == 3) {
          vec2 quv = (fromShapeUnits(pk) - uImageOffset) / uBaseSize;
          on = !held && all(greaterThanEqual(quv, vec2(0.0))) && all(lessThanEqual(quv, vec2(1.0)));
        } else if (held) {
          clear = false;
          break;
        }
      }
      if (clear) {
        at = on ? beyond : back;
        src = LEAN_POS(i, vec2(at - pull, y));
        heldSrc = 0.0;
        break;
      }
    }
  }
  float f = clamp((at - info.w) / max(span, 1e-6), 0.0, 1.0) * 65535.0;
  vec2 uv = clamp((fromShapeUnits(src) - uImageOffset) / uBaseSize, vec2(0.0), vec2(1.0));
  float lum = dot(textureLod(uBase, uv, 0.0).rgb, vec3(0.2126, 0.7152, 0.0722));
  outColor = vec4(floor(f / 256.0) / 255.0, mod(f, 256.0) / 255.0, lum, heldSrc > HELD_CLEAR ? 0.5 : 1.0);
}
`

const GEOMETRY = (kind: 'trail' | 'fill') => /* glsl */ `
#define LEAN_${kind.toUpperCase()} 1
// A colour fix here (leanStretch): blending in, where the second side's copy
// is read (print px) and how much of it; recolouring, this line's read (s, t).
// Then the fix + 1.
layout(location = 2) out vec4 outFix;

/**
 * One interval's say in a look-up (leanCross), read in order along the line:
 * whether s is inside it, and the intervals just before and after it.
 */
void leanPair(vec2 iv, float s, inout bool inside, inout vec2 span, inout vec2 before, inout vec2 after, inout bool wantNext, inout vec2 last, inout float exitBehind, inout float entryAhead) {
  if (iv.x > 1e8) return;
  if (wantNext) {
    after = iv;
    wantNext = false;
  }
  if (s >= iv.x && s < iv.y) {
    inside = true;
    span = iv;
    before = last;
    wantNext = true;
  }
  if (iv.y <= s) exitBehind = max(exitBehind, iv.y);
  if (iv.x > s) entryAhead = min(entryAhead, iv.x);
  last = iv;
}

/**
 * The first crossing along line t from s, back (lower s) or ahead, to inside
 * or outside the shape, as streakCrossing; with bridge, a gap outside no
 * longer than FILL_BRIDGE is carried across, as edgeCross does. -1 if none
 * within limit (the limit itself once a gap has been bridged).
 */
float leanCross(int i, float s, float t, bool back, float limit, bool wantInside, bool bridge) {
  int j = crossLine(i, t);
  if (j < 0) return wantInside ? -1.0 : 0.0;
  bool inside = false;
  vec2 span = vec2(0.0);
  vec2 before = vec2(1e9);
  vec2 after = vec2(1e9);
  bool wantNext = false;
  vec2 last = vec2(1e9);
  float exitBehind = -1e9;
  float entryAhead = 1e9;
  for (int p = 0; p < 4; p++) {
    vec4 v = texelFetch(uStreakPaths, ivec2(j, CROSS_ROW + i * 4 + p), 0);
    leanPair(v.xy, s, inside, span, before, after, wantNext, last, exitBehind, entryAhead);
    leanPair(v.zw, s, inside, span, before, after, wantNext, last, exitBehind, entryAhead);
  }
  float d;
  bool bridged = false;
  if (wantInside) {
    d = inside ? 0.0 : back ? s - exitBehind : entryAhead - s;
  } else if (!inside) {
    d = 0.0;
  } else if (back) {
    d = s - span.x;
    if (bridge && before.x < 1e8 && span.x - before.y < FILL_BRIDGE) {
      d = s - before.x;
      bridged = true;
    }
  } else {
    d = span.y - s;
    if (bridge && after.x < 1e8 && after.x - span.y < FILL_BRIDGE) {
      d = after.y - s;
      bridged = true;
    }
  }
  if (d <= limit) return d;
  return bridged ? limit : -1.0;
}

/**
 * Line t's colour edge, as the full shader's line table has it: a trail's
 * where the line last leaves the shape, a fill's where it first enters;
 * -1e9 where the line misses the shape. A fix borrowing line t reads it
 * from there, whatever this pixel's own line is doing.
 */
float leanLineEdge(int i, float t, bool trail) {
  int j = crossLine(i, t);
  if (j < 0) return -1e9;
  float first = 1e9;
  float last = -1e9;
  for (int p = 0; p < 4; p++) {
    vec4 v = texelFetch(uStreakPaths, ivec2(j, CROSS_ROW + i * 4 + p), 0);
    if (v.x < 1e8) {
      first = min(first, v.x);
      last = max(last, v.y);
    }
    if (v.z < 1e8) {
      first = min(first, v.z);
      last = max(last, v.w);
    }
  }
  if (first > 1e8) return -1e9;
  // Inside at either end of the table's range: that end.
  vec4 r = uCrossRange[i];
  return trail ? min(last, r.y) : max(first, r.x);
}

/**
 * A trail's colour edge on line t (where it leaves the shape, back from the
 * pixel at s), the crossing table's e put exactly on this line: the table's
 * is its nearest line's, and where the outline runs at a slant to the lines
 * that is a little way along it, which drew a saw edge along the bars.
 * Searched within w either side; the table's if the edge is not there.
 */
float leanExitOn(int i, float t, float s, float e, float w) {
  float lo = e - w;
  float hi = min(e + w, s);
  if (hi <= lo || !insideStreak(i, LEAN_POS(i, vec2(lo, t))) || insideStreak(i, LEAN_POS(i, vec2(hi, t)))) return e;
  int halvings = 12 + min(uStreakCount, 0);
  for (int b = 0; b < halvings; b++) {
    float mid = 0.5 * (lo + hi);
    if (insideStreak(i, LEAN_POS(i, vec2(mid, t)))) lo = mid;
    else hi = mid;
  }
  return hi;
}

/** Where the bar's centre line crosses the edge line st crossed crossAt back (barCrossing). */
float leanBarCrossing(int i, vec2 st, float centre, float crossAt, float limit, bool edgeEntersShape) {
  vec2 c = vec2(st.x - crossAt, centre);
  bool here = insideStreak(i, LEAN_POS(i, c));
  bool past = here == edgeEntersShape;
  float r = leanCross(i, c.x, c.y, !past, limit, past != edgeEntersShape, !past && !edgeEntersShape);
  return r < 0.0 ? crossAt : past ? crossAt - r : crossAt + r;
}

/**
 * Where fix f takes line t's colour from, by itself: the nearer side's line
 * mirrored in (t2, with the far side's t3 fading in by w3 over the middle),
 * or the part picked on the photo, stretched across it.
 */
void leanStretchOf(int f, float t, out float t2, out float t3, out float w3) {
  vec4 span = uFixSpan[f];
  float lo = span.y;
  float hi = span.z;
  float k = clamp((t - lo) / max(hi - lo, 1e-6), 0.0, 1.0);
  vec4 from = uFixFrom[f];
  t2 = t;
  t3 = t;
  w3 = 0.0;
  if (from.w > 1.5) {
    t2 = from.x + k * (from.y - from.x);
    t3 = t2;
    return;
  }
  bool before = from.z > 0.5;
  bool after = from.w > 0.5;
  float tb = lo - (t - lo);
  float ta = hi + (hi - t);
  float wa = before && after ? smoothstep(0.3, 0.7, k) : after ? 1.0 : 0.0;
  t2 = wa > 0.5 ? ta : tb;
  t3 = wa > 0.5 ? tb : ta;
  w3 = wa > 0.5 ? 1.0 - wa : wa;
}

/**
 * The colour fix over line t of streak i, if any (-1 if none): a stretch
 * across the streak, any width. Where fixes overlap, the one added last is
 * the one that applies, as layers do. Blending in (mode 0), the lines it
 * takes its colour from instead: copied from beside it (each line mirrored
 * across the stretch's nearer side, so at its sides it reads the very line
 * next to it, with no seam, the two sides fading into each other over the
 * middle: t2, then t3 with weight w3), or from a part picked on the photo,
 * stretched to fit. A line it copies that an earlier fix changes is taken
 * as that fix has it, so a fix inside another refines it. Its other modes
 * keep the lines' own colours (t2 = t).
 */
int leanStretch(int i, float t, out float t2, out float t3, out float w3) {
  t2 = t;
  t3 = t;
  w3 = 0.0;
  int found = -1;
  for (int k = 0; k < FIXES; k++) {
    if (k >= uFixCount) break;
    int f = uFixCount - 1 - k;
    if (int(uFixSpan[f].x) == i && fixCover(f, t, 0.0) > 0.0) {
      found = f;
      break;
    }
  }
  if (found < 0 || uFixSpan[found].w > 0.5) return found;
  leanStretchOf(found, t, t2, t3, w3);
  // Through the earlier fixes the copied lines fall in, each taken as that fix has it.
  for (int k = 0; k < FIXES; k++) {
    int g = found - 1 - k;
    if (g < 0) break;
    if (int(uFixSpan[g].x) != i || uFixSpan[g].w > 0.5) continue;
    float a2;
    float a3;
    float aw;
    if (fixCover(g, t2, 0.0) > 0.0) {
      leanStretchOf(g, t2, a2, a3, aw);
      t2 = aw > 0.5 ? a3 : a2;
    }
    if (w3 > 0.0 && fixCover(g, t3, 0.0) > 0.0) {
      leanStretchOf(g, t3, a2, a3, aw);
      t3 = aw > 0.5 ? a3 : a2;
    }
  }
  return found;
}

#ifdef LEAN_SKIP
/**
 * Skipping masked colours (the full shader's skipRemap, with this program's
 * coordinates): line t of bar bandIdx, whose colour own (read off from its
 * line's edge) is held back by a mask, takes a clear bar's colour from the
 * line table (on unit 12), read as far from its edge: its own line's, if
 * that found a clear colour further back; else a slice of one of the clear
 * bars past the masked run, picked a golden-ratio step on, so the bars of
 * the run spread over many sources; else the nearest clear bar itself.
 *
 * The candidates are tried in that order in one loop, so whether each is
 * held is asked at one place: Direct3D's compiler copies a function at
 * every place it is called, and the mask test is large.
 */
vec2 leanSkip(int i, float bandIdx, float t, float off, float band, vec2 own, float ownLimit) {
  vec4 info = uLineInfo[i];
  int hidden = min(uStreakCount, 0);
  float w = t - bandIdx * band;
  float nearB = -1.0;
  float nearA = -1.0;
  float side = 1.0;
  float near = 0.0;
  float kPick = bandIdx;
  // -1: own, as it is; 0: its own line's clear colour; 1-4: slices of the
  // picked clear bar and the nearest (and each plainly); 5: the nearest bar.
  for (int c = -1; c < 6 + hidden; c++) {
    vec2 there = own;
    float limit = HELD_CLEAR;
    if (c == -1) {
      limit = ownLimit;
    } else {
      if (info.z <= 0.0) break;
      if (c == 0) {
        vec4 l = tableLine(i, int(floor(((bandIdx + 0.5) * band - info.x) / info.y)));
        if (l.w < 0.5 || l.z > 0.5) continue;
        there = LEAN_POS(i, vec2(l.x + off, bandIdx * band + w));
      } else {
        if (c == 1) {
          // The nearest clear bar each way, judged on its middle line.
          for (int d = 1; d <= 96 + hidden; d++) {
            float fd = float(d);
            if (nearB < 0.0) {
              vec4 l = tableLine(i, int(floor(((bandIdx - fd + 0.5) * band - info.x) / info.y)));
              if (l.w > 0.5 && l.z < 0.5) nearB = fd;
            }
            if (nearA < 0.0) {
              vec4 l = tableLine(i, int(floor(((bandIdx + fd + 0.5) * band - info.x) / info.y)));
              if (l.w > 0.5 && l.z < 0.5) nearA = fd;
            }
            if (nearB > 0.0 && nearA > 0.0) break;
          }
          if (nearB < 0.0 && nearA < 0.0) break;
          // A side, the nearer more often; then which of the next clear bars that way.
          float h = hash11(bandIdx * 4.77 + 3.1);
          bool after = nearB < 0.0 || (nearA > 0.0 && h < nearB / (nearA + nearB));
          side = after ? 1.0 : -1.0;
          near = after ? nearA : nearB;
          int found = 0;
          for (int d = 0; d < 128 + hidden; d++) {
            float kk = bandIdx + side * (near + float(d));
            vec4 l = tableLine(i, int(floor(((kk + 0.5) * band - info.x) / info.y)));
            if (l.w > 0.5 && l.z < 0.5) found++;
            if (found >= 24) break;
          }
          float u = fract(bandIdx * PHI + (after ? 0.37 : 0.71) + (hash11(bandIdx * 6.13) - 0.5) * 0.18);
          int want = int(floor(u * float(found)));
          int seen = 0;
          kPick = bandIdx + side * near;
          for (int d = 0; d < 128 + hidden; d++) {
            float kk = bandIdx + side * (near + float(d));
            vec4 l = tableLine(i, int(floor(((kk + 0.5) * band - info.x) / info.y)));
            if (l.w > 0.5 && l.z < 0.5) {
              if (seen == want) {
                kPick = kk;
                break;
              }
              seen++;
            }
          }
        }
        float y2;
        if (c <= 4) {
          // m 0: the picked bar; m 1: the nearest. n 0: a slice of it, stretched
          // and maybe flipped; n 1: the plain line, which may be a little held.
          int m = (c - 1) / 2;
          int n = (c - 1) - m * 2;
          float k = m == 0 ? kPick : bandIdx + side * near;
          y2 = n == 0 ? barSlice(k * band, w, band, hash11(bandIdx * 9.13 + float(m))) : k * band + w;
          if (n == 1) limit = 0.4999;
        } else {
          y2 = (bandIdx + side * near) * band + w;
          limit = 0.4999;
        }
        vec4 line = tableLine(i, int(floor((y2 - info.x) / info.y)));
        if (line.w < 0.5 || (c == 5 && line.z > 0.5)) continue;
        there = LEAN_POS(i, vec2(line.x + off, y2));
      }
    }
    if (streakHeld(there) <= limit) return there;
  }
  return own;
}

/**
 * A bar's colour source past what a mask holds back: its own (line t of
 * bar bandIdx), or a borrowing fix's (fixAt, from line t), unless the fix
 * takes masked colours as they are.
 */
vec2 leanSkipped(int i, vec2 src, int fixAt, float t, float bandIdx, float off, float band) {
  bool skips = fixAt >= 0 ? mod(uFixInfo[fixAt].w, 2.0) < 0.5 : uStreakInfo[i].x > 0.5;
  if (!skips) return src;
  // (bandIdx may be fractional: mirrored, the bars are laid from the middle line, see barGrid.)
  float g = fract(bandIdx) * band;
  return leanSkip(i, fixAt >= 0 ? floor((t - g) / band) + g / band : bandIdx, t, off, band, src, 0.25);
}
#endif

#ifdef LEAN_LIGHT
// Where a light held behind the streaks is read, past this trail's bar end (gLightShift).
vec2 gLeanLight = vec2(0.0);
#endif

/**
 * Streak i at printPx: how much of it (0: none), and through the outs where
 * its colour comes from (print px), how far along its bar (for the tone),
 * where Repeat reads from (the colour's edge and this pixel, along s) and
 * the line t (for Repeat and fixes).
 */
float leanGeometry(int i, vec2 printPx, out vec2 hitSrc, out float along, out vec2 rep, out float lineT, out vec4 fixOut) {
  hitSrc = printPx;
  along = 0.0;
  rep = vec2(0.0);
  lineT = 0.0;
  fixOut = vec4(0.0);
  vec4 extra = uStreakExtra[i];
  vec2 q = toShapeUnits(printPx);
  vec4 ends = uStreakEnds[i];
  vec4 edge = uStreakEdge[i];
  float feather = edge.x;
  float endSoft = uStreakEndSoft[i];
  float pull = edge.y;
  float band = max(extra.x, 1e-4);
  vec4 ring = uStreakSweep[i];
  if (ring.w > 0.5) {
    // Around: bars are arcs orbiting the middle, in rings a band wide
    // stacked out from the edge, each from its own angle for its length.
    vec2 cen = uStreakVanish[i].xy;
    vec2 d = q - cen;
    float r = length(d);
    float R = max(ring.z, 1e-3);
    if (r < R || (ring.y > 0.0 && r > ring.y)) return 0.0;
    float b = floor((r - R) / band);
    float th0 = hash11(b * 7.31 + extra.y * 1.37 + 3.0) * 6.2831853;
    float vary = hash11(b * 3.17 + extra.y * 0.71 + 9.0);
    float sweep = min(edge.z * mix(ends.y, ends.x, vary) / R, 6.2831853);
    float into = mod(atan(d.y, d.x) - th0, 6.2831853);
    if (into > sweep) return 0.0;
    float w = endSoft > 0.0 ? 1.0 - smoothstep(sweep - endSoft / R, sweep, into) : 1.0;
    float rr = max(R - 0.002 - pull - (r - (R + b * band)), 0.0);
    along = into / max(sweep, 1e-4);
    hitSrc = mix(printPx, fromShapeUnits(cen + rr * vec2(cos(th0), sin(th0))), uStreakAmount);
    return w;
  }
  vec2 st = LEAN_COORDS(i, q);
  lineT = st.y;
  // Mirrored, the bars are laid from the middle line (gridOff), wherever it is.
  float mi;
  float gridOff = barGrid(i, band, mi);
  float bandIdx = floor((st.y - gridOff) / band);
  float barMid = (bandIdx + 0.5) * band + gridOff;
  float barVary = uStreakStripe[i].w;
  if (barVary > 0.0) {
    float k = bandIdx;
    float y = st.y - gridOff;
    float e0 = (k + barEdgeShift(i, k, mi) * barVary) * band;
    float e1 = (k + 1.0 + barEdgeShift(i, k + 1.0, mi) * barVary) * band;
    if (y < e0) {
      k -= 1.0;
      e1 = e0;
      e0 = (k + barEdgeShift(i, k, mi) * barVary) * band;
    } else if (y >= e1) {
      k += 1.0;
      e0 = e1;
      e1 = (k + 1.0 + barEdgeShift(i, k + 1.0, mi) * barVary) * band;
    }
    bandIdx = k;
    barMid = 0.5 * (e0 + e1) + gridOff;
  }
  vec4 picks = barPicks(i, bandIdx, mi);
  // The bar's number where the bars start from line 0, for what reads the line table by it (whole when not mirrored).
  float barAt = bandIdx + gridOff / band;
  float frac = mix(ends.x, ends.y, mix(picks.y, picks.x, ends.z));
  float turn = picks.z * uStreakPathInfo[i].w;
  float tip = tan(clamp(picks.w * (edge.w + turn), -1.45, 1.45)) * (st.y - barMid);
  vec4 vp = uStreakVanish[i];
  bool persp = vp.w != 0.0;
  float weight = 0.0;
  vec2 src = q;
#ifdef LEAN_TRAIL
  // Trail: outside the shape, back along the flow to it.
  if (insideStreak(i, q)) return 0.0;
  float len = edge.z * frac + tip;
  bool drawnEnd = uStreakEndInfo[i].w > 0.5;
  float endAt = drawnEnd ? endLineAt(i, barMid) : 0.0;
  // Mirrored, the far side's bars end where their partners end (their
  // middle line pm as far across the other side), so neither the
  // outline's unevenness nor the end line's shows: they may run further,
  // so the search back to the shape goes as far as the shape is across.
  vec4 mirror = uStreakMirror[i];
  bool endsMirrored = mirror.z > 0.5 && picks.w < 0.0 && mirror.y < 1.0;
  float pm = 2.0 * mirror.x - barMid;
  float endP = endsMirrored && drawnEnd ? endLineAt(i, pm) : endAt;
  float endCut = max(endAt, endP);
  // Past the end line nothing is streaked, but a light behind the streaks
  // still needs the bar's length there: searched from the line.
  float over = 0.0;
  if (drawnEnd && st.x > endCut + band) {
#ifdef LEAN_LIGHT
    over = st.x - endCut - band;
    if (over > LIGHT_REACH) return 0.0;
    st.x -= over;
#else
    return 0.0;
#endif
  }
  if (len <= 0.0 && !drawnEnd) return 0.0;
  float limit = drawnEnd ? max(st.x - uStreakEndInfo[i].z, 0.0) + band
    : persp ? perspectiveReach(vp, len, vp.w * st.x) * 1.25 + band : len * 1.25 + band;
  if (endsMirrored) limit += extra.z;
#ifdef LEAN_LIGHT
  if (!drawnEnd) limit += LIGHT_REACH;
#endif
  float hi = leanCross(i, st.x, st.y, true, limit, true, false);
  if (hi < 0.0) return 0.0;
  hi = st.x - leanExitOn(i, st.y, st.x, st.x - hi, band);
  float run = leanBarCrossing(i, st, barMid, hi, limit, true);
  // Where the partner leaves the shape, back from here along its line (-1: it does not).
  float runP = -1.0;
  if (endsMirrored) {
    float ph = leanCross(i, st.x, pm, true, limit, true, false);
    if (ph >= 0.0) runP = leanBarCrossing(i, vec2(st.x, pm), pm, ph, limit, true);
  }
  // In stripes, the line this one reads from, and where that leaves the shape.
  float sy = stripeRead(i, st.y);
  float leaves = sy == st.y ? hi : leanBarCrossing(i, st, sy, hi, limit, true);
  float soft = endSoft;
  if (drawnEnd) {
    len = max(endAt - (st.x - run), 0.0) * frac + tip;
    // The partner's end, from here: as far past where it leaves as it runs toward its end line.
    if (runP >= 0.0) len = mix((run - runP) + max(endP - (st.x - runP), 0.0) * frac + tip, len, mirror.y);
  } else if (persp) {
    float k = perspectiveLength(vp, st.x - run);
    len *= k;
    soft *= k;
    if (vp.w < 0.0) len = min(len, 0.98 * vp.w * (st.x - run));
  }
  // How much further along the partner leaves the shape, once the length is in perspective.
  if (runP >= 0.0 && !drawnEnd) len += (run - runP) * (1.0 - mirror.y);
  run += over;
  weight = over > 0.0 ? 0.0 : soft > 0.0 ? 1.0 - smoothstep(len - soft, len, run) : step(run, len);
  along = run / max(len, 1e-4);
#ifdef LEAN_LIGHT
  // Read as far on as the bar falls short of the longest, so the light's
  // edge keeps the same distance from every bar's end.
  if (weight < 1.0 && frac > 1e-3) {
    float longest = max(ends.x, ends.y);
    float shortBy = max(len - tip, 0.0) * max(longest - frac, 0.0) / frac;
    if (shortBy > 0.0) gLeanLight = fromShapeUnits(LEAN_POS(i, vec2(st.x + over + shortBy, st.y))) - printPx;
  }
  return 0.0;
#endif
  if (weight <= 0.0) return 0.0;
  src = LEAN_POS(i, vec2(st.x - leaves - 0.002 - pull, sy));
  float lineAt = colourLineS(i, sy);
  if (lineAt > -1e8) src = LEAN_POS(i, vec2(lineAt, sy));
  rep = vec2(st.x - leaves - 0.002, st.x);
  lineT = sy;
  float t2;
  float t3;
  float w3;
  int fixAt = leanStretch(i, st.y, t2, t3, w3);
  bool borrowed = fixAt >= 0 && uFixSpan[fixAt].w < 0.5;
  if (fixAt >= 0 && !borrowed) fixOut = vec4(st.x - leaves - 0.002 - pull, st.y, float(fixAt) + 1.0, 0.0);
  if (borrowed) {
    // The copied lines' colours, each where that line leaves the shape (as
    // far in as this one reads from its own edge).
    float edge2 = leanLineEdge(i, t2, true);
    if (edge2 > -1e8) {
      src = LEAN_POS(i, vec2(edge2 - 0.002 - pull, t2));
      lineT = t2;
      float edge3 = w3 > 0.0 ? leanLineEdge(i, t3, true) : -1e9;
      vec2 src3 = edge3 > -1e8 ? mix(printPx, fromShapeUnits(LEAN_POS(i, vec2(edge3 - 0.002 - pull, t3))), uStreakAmount) : vec2(0.0);
      fixOut = vec4(src3, float(fixAt) + 1.0, edge3 > -1e8 ? w3 : 0.0);
    } else {
      borrowed = false;
    }
  }
#ifdef LEAN_SKIP
  src = leanSkipped(i, src, borrowed ? fixAt : -1, borrowed ? t2 : st.y, barAt, -0.002 - pull, band);
#endif
#else
  // Fill: the colour from where the line entered the shape, carried along it.
  bool clipped = uStreakFlags[i].x > 0.5;
  bool across = uStreakFlags[i].y > 0.5;
  bool fromEdge = !clipped || ends.w > 0.5;
  float reach = extra.z;
  bool inside = insideStreak(i, q);
  float cover = clipped && feather > 0.0 ? featherCover(i, q) : 1.0;
  if (!inside && clipped && cover <= 0.0) return 0.0;
  float depth = 0.0;
  if (inside) {
    depth = leanCross(i, st.x, st.y, true, reach, false, true);
    if (depth < 0.0) depth = reach;
  } else {
    float runOn = edge.z * max(ends.x, ends.y);
    if (persp) runOn = perspectiveReach(vp, runOn, vp.w * st.x) * 1.25;
    float exitAt = leanCross(i, st.x, st.y, true, clipped ? 2.0 * feather : runOn + 4.5 * band, true, false);
    if (exitAt >= 0.0) {
      // From a hair inside the edge: exactly on it, the line counts as outside.
      const float INTO_EDGE = 1e-4;
      float through = leanCross(i, st.x - exitAt - INTO_EDGE, st.y, true, reach, false, true);
      depth = exitAt + INTO_EDGE + (through < 0.0 ? reach : through);
    } else {
      if (!clipped) return 0.0;
      float ahead = leanCross(i, st.x, st.y, false, 2.0 * feather, true, false);
      if (ahead < 0.0) return 0.0;
      depth = -ahead;
    }
  }
  float barDepth = leanBarCrossing(i, st, barMid, depth, reach, false);
  float sy = stripeRead(i, st.y);
  float enters = sy == st.y ? depth : leanBarCrossing(i, st, sy, depth, reach, false);
  float run = reach;
  if (clipped && (across || !fromEdge)) {
    const float INTO = 5e-4;
    float r = leanCross(i, st.x - barDepth + INTO, barMid, false, reach, false, true);
    if (r > 0.0) run = r + INTO;
    float r1 = leanCross(i, st.x - barDepth + INTO, barMid - 0.35 * band, false, reach, false, true);
    if (r1 > 0.0) run = max(run, r1 + INTO);
    float r2 = leanCross(i, st.x - barDepth + INTO, barMid + 0.35 * band, false, reach, false, true);
    if (r2 > 0.0) run = max(run, r2 + INTO);
    if (inside && barDepth > run) {
      barDepth = depth;
      float own = leanCross(i, st.x - depth + INTO, st.y, false, reach, false, true);
      run = own > 0.0 ? own + INTO : reach;
    }
  }
  float full = (clipped && across ? run : edge.z) * frac;
  if (persp && !(clipped && across)) {
    full *= perspectiveLength(vp, st.x - barDepth);
    if (vp.w < 0.0) full = min(full, 0.98 * vp.w * (st.x - barDepth));
  }
  float readAt = st.x - depth - pull;
  if (fromEdge) {
    float stop = full + tip;
    along = barDepth / max(full + tip, 1e-4);
    if (clipped && full >= run * 0.999) stop += 2.0 * feather;
    weight = endSoft > 0.0 ? 1.0 - smoothstep(stop - endSoft, stop, barDepth) : step(barDepth, stop);
  } else {
    float start = max(run - full, 0.0);
    weight = endSoft > 0.0 ? smoothstep(start + tip, start + tip + endSoft, barDepth) : step(start + tip, barDepth);
    along = (barDepth - start) / max(run - start, 1e-4);
    readAt = st.x - barDepth + start - pull;
  }
  weight *= cover;
  if (weight <= 0.0) return 0.0;
  src = LEAN_POS(i, vec2(readAt + depth - enters, sy));
  float lineAt = colourLineS(i, sy);
  if (lineAt > -1e8) src = LEAN_POS(i, vec2(lineAt, sy));
  rep = vec2(readAt + pull + depth - enters, st.x + depth - enters);
  lineT = sy;
  float t2;
  float t3;
  float w3;
  int fixAt = leanStretch(i, st.y, t2, t3, w3);
  bool borrowed = fixAt >= 0 && uFixSpan[fixAt].w < 0.5;
  if (fixAt >= 0 && !borrowed) fixOut = vec4(readAt + depth - enters, st.y, float(fixAt) + 1.0, 0.0);
  if (borrowed) {
    // The copied lines' colours from where each enters the shape, as far on
    // as this one reads from its own entry.
    float on = readAt - (st.x - depth);
    float edge2 = leanLineEdge(i, t2, false);
    if (edge2 > -1e8) {
      src = LEAN_POS(i, vec2(edge2 + on, t2));
      lineT = t2;
      float edge3 = w3 > 0.0 ? leanLineEdge(i, t3, false) : -1e9;
      vec2 src3 = edge3 > -1e8 ? mix(printPx, fromShapeUnits(LEAN_POS(i, vec2(edge3 + on, t3))), uStreakAmount) : vec2(0.0);
      fixOut = vec4(src3, float(fixAt) + 1.0, edge3 > -1e8 ? w3 : 0.0);
    } else {
      borrowed = false;
    }
  }
#ifdef LEAN_SKIP
  src = leanSkipped(i, src, borrowed ? fixAt : -1, borrowed ? t2 : st.y, barAt, readAt - (st.x - depth), band);
#endif
#endif
  hitSrc = mix(printPx, fromShapeUnits(src), uStreakAmount);
  return weight;
}

/**
 * How much of streak i the masks let through here: its own masks and key
 * (returned), and the streaks section's (keep5), apart for Clean edges.
 */
float leanKeep(int i, vec2 printPx, vec3 here, out float keep5) {
  keep5 = 1.0;
  float keep = 1.0;
  ivec2 su = uSectionMask[5];
  ivec2 sm = uStreakMask[i];
  if (uMaskCount > 0 && (su.y != 0 || sm.y != 0)) {
    vec2 mq = toShapeUnits(printPx);
    float clearS = 1.0;
    float clearM = 1.0;
    for (int m = 0; m < uMaskCount; m++) {
      bool inS = su.y != 0 && ((su.x >> m) & 1) == 1;
      bool inM = sm.y != 0 && ((sm.x >> m) & 1) == 1;
      if (!inS && !inM) continue;
      float own;
      float c = maskAt(m, mq, here, 0.0, own);
      if (inS) clearS *= 1.0 - c;
      if (inM) clearM *= 1.0 - c;
    }
    if (su.y != 0) keep5 = su.y == 2 ? 1.0 - clearS : clearS;
    if (sm.y != 0) keep *= sm.y == 2 ? 1.0 - clearM : clearM;
  }
  vec4 k = uStreakKey[i];
  if (k.x > 0.5) {
    float v = k.y > 0.5 ? here.b : dot(here, vec3(0.2126, 0.7152, 0.0722));
    float lighter = smoothstep(k.z - k.w, k.z + k.w, v);
    keep *= k.x > 1.5 ? lighter : 1.0 - lighter;
  }
  return keep;
}

void main() {
  int i = uLeanStreak;
  vec2 split;
  vec2 printPx = leanScene(uRegionOrigin + vUv * uRegionSize, split);
  vec2 basePx = printPx - uImageOffset;
  vec3 here = textureLod(uBase, clamp(basePx / uBaseSize, vec2(0.0), vec2(1.0)), 0.0).rgb;
  float keep5;
#ifdef LEAN_LIGHT
  // Only a streak before the one found here (the geometry draws', on unit
  // 15), or that one, moves the light, as the full shader's search stops there.
  vec4 found = texelFetch(uMatteFore, ivec2(gl_FragCoord.xy), 0);
  if (found.w > 0.5 && i > int(floor(found.w)) - 1) discard;
  if (leanKeep(i, printPx, here, keep5) * keep5 <= 0.0) discard;
  vec2 src;
  float along;
  vec2 rep;
  float lineT;
  vec4 fixOut;
  leanGeometry(i, printPx, src, along, rep, lineT, fixOut);
  if (gLeanLight == vec2(0.0)) discard;
  outColor = vec4(gLeanLight, 0.0, 1.0);
  outUv = vec4(0.0);
  outFix = vec4(0.0);
#else
  // The section's masks are kept apart (in the streak's index, below): the
  // colour draw needs the streak as it would be here unmasked, for Clean edges.
  float keep = leanKeep(i, printPx, here, keep5);
  if (keep <= 0.0) discard;
  vec2 src;
  float along;
  vec2 rep;
  float lineT;
  vec4 fixOut;
  float w = leanGeometry(i, printPx, src, along, rep, lineT, fixOut) * keep;
  if (w <= 0.0) discard;
  outColor = vec4(src, w, along);
  outUv = vec4(rep, lineT, float(i) + 1.0 + 0.5 * clamp(keep5, 0.0, 1.0));
  outFix = fixOut;
#endif
}
`

const COLOUR = /* glsl */ `
// The matte (for Clean edges) and where a light behind the streaks is read
// (the light draw's), on units of the look's passes this draw does not use.
uniform sampler2D uLeanMatteBack;
uniform sampler2D uLeanMatteFore;
uniform sampler2D uLeanLight;

vec4 leanMatteMean(bool fore, vec2 uv) {
  vec4 m = vec4(0.0);
  float g = 1.0;
  for (int k = 0; k < 5; k++) {
    m += g * (fore ? textureLod(uLeanMatteFore, uv, uMatteLod + float(k)) : textureLod(uLeanMatteBack, uv, uMatteLod + float(k)));
    g *= 0.35;
  }
  return m.a < 1e-4 ? vec4(0.0) : vec4(srgbToLinear(clamp(m.rgb / m.a, 0.0, 1.0)), 1.0);
}

/** edgeBehind, from this draw's units: how much of here is what is behind a kept subject (back). */
float leanEdgeBehind(vec2 uv, vec3 here, out vec3 back) {
  vec4 b = leanMatteMean(false, uv);
  vec4 f = leanMatteMean(true, uv);
  back = b.rgb;
  if (b.a == 0.0 || f.a == 0.0) return 0.0;
  vec3 fore = f.rgb;
  vec3 i = srgbToLinear(here);
  vec3 d = fore - back;
  float dd = dot(d, d);
  float a = clamp(dot(i - back, d) / max(dd, 1e-6), 0.0, 1.0);
  float off = length(i - (back + a * d));
  float sure = smoothstep(0.002, 0.01, dd) * (1.0 - smoothstep(0.12, 0.3, off));
  return (1.0 - a) * sure;
}
/**
 * The streak cache from the trail and fill draws (on units 14 and 15, where
 * the look's shader has its matte): the streak's tone along its bar and its
 * fixes', Repeat's reads, and its colour over the photo.
 */
void main() {
  ivec2 at = ivec2(gl_FragCoord.xy);
  vec4 g0 = texelFetch(uMatteBack, at, 0);
  vec4 g1 = texelFetch(uMatteFore, at, 0);
  vec2 framePx = uRegionOrigin + vUv * uRegionSize;
  vec2 rawBasePx = framePx - uImageOffset;
  float baseLod = max(0.0, log2(max(max(length(dFdx(rawBasePx)), length(dFdy(rawBasePx))), 1e-6)));
  // Output pixels per frame unit: from the whole picture's, not this target's
  // size, which is one band of an export's (drawLeanTiles).
  vec2 perPx = 1.0 / max(abs(vec2(dFdx(framePx.x), dFdy(framePx.y))), vec2(1e-6));
  vec2 split;
  vec2 printPx = leanScene(framePx, split);
  vec2 basePx = printPx - uImageOffset;
  vec3 here = textureLod(uBase, clamp(basePx / uBaseSize, vec2(0.0), vec2(1.0)), baseLod).rgb;
  outColor = vec4(here, 0.0);
  // The glass's own colour fringe, where nothing is streaked.
  vec2 fringeLum = vec2(0.0);
  const vec3 W = vec3(0.2126, 0.7152, 0.0722);
  if (dot(split, split) > 0.01 && uLinePass != 2) {
    vec3 r = textureLod(uBase, streakUv((basePx - split) / uBaseSize), baseLod).rgb;
    vec3 b = textureLod(uBase, streakUv((basePx + split) / uBaseSize), baseLod).rgb;
    float l = dot(here, W);
    fringeLum = vec2(dot(r, W) - l, dot(b, W) - l);
  }
  // How far on a light held behind the streaks is read here.
  vec2 lightShift = uLightBehind == 1 && uLinePass != 2 ? texelFetch(uLeanLight, at, 0).xy : vec2(0.0);
  outUv = vec4(basePx / uBaseSize, pack12(fringeLum, 2047.0), pack12(lightShift, 1.0));
  if (g1.w < 0.5 || g0.z <= 0.0) return;
  // The streak, and how much the streaks section's masks let through here.
  float found = floor(g1.w);
  int i = int(found) - 1;
  float keep5 = clamp((g1.w - found) * 2.0, 0.0, 1.0);
  float band = max(uStreakExtra[i].x, 1e-4);
  float lineT = g1.z;
  // The tone along the bar, and each fix's on its bars.
  vec4 toneA = uStreakToneStart[i];
  vec4 toneB = uStreakToneEnd[i];
  float t = clamp(g0.w, 0.0, 1.0);
  float change = toneB.w > 0.0 ? smoothstep(toneA.w, toneA.w + toneB.w, t) : step(toneA.w, t);
  vec3 tone = mix(toneA.xyz, toneB.xyz, change);
  float carryCopy = uStreakRepeatMask[i] < -1.5 ? 0.0 : 1.0;
  // A fix covers bars by this pixel's own line, not the one its colour is
  // read from (another, where the fix borrows).
  float ownT = uFixCount > 0 ? LEAN_COORDS(i, toShapeUnits(printPx)).y : 0.0;
  for (int f = 0; f < FIXES; f++) {
    if (f >= uFixCount) break;
    if (int(uFixSpan[f].x) != i) continue;
    vec4 ft = uFixTone[f];
    float c = fixCover(f, ownT, band);
    if (c <= 0.0) continue;
    tone += c * vec3(ft.x, ft.y, 0.0);
    tone.z *= mix(1.0, ft.z, c);
    float carry = floor(uFixInfo[f].w / 2.0 + 0.01);
    if (carry > 0.5) carryCopy = mix(carryCopy, carry < 1.5 ? 1.0 : 0.0, c);
  }
  // A colour fix here (the third target, on unit 12; see leanStretch).
  vec4 g2 = texelFetch(uLineTable, at, 0);
  int fixAt = int(g2.z + 0.5) - 1;
  // Unmasked by the section (for Clean edges), and as shown.
  float under = clamp(g0.z * clamp(tone.z, 0.0, 1.0), 0.0, 1.0);
  if (uStreakFlags[i].w > 0.5) under = grainCut(under, printPx);
  if (under <= 0.0) return;
  float w = under * keep5;
  // Kept in front of the streaks by a mask with Clean edges: the part of an
  // edge pixel that is what is behind becomes the streak, as if the subject
  // had been photographed in front of it (see edgeBehind).
  float behind = 0.0;
  vec3 back = vec3(0.0);
  ivec2 su = uSectionMask[5];
  if (keep5 < 1.0 && uMatteOn == 1 && uMaskCount > 0 && su.y != 0) {
    vec2 mq = toShapeUnits(printPx);
    float cleanHere = 0.0;
    for (int m = 0; m < uMaskCount; m++) {
      if (((su.x >> m) & 1) == 1 && (su.y == 2 || maskCover(m, mq, here) > 1e-3)) cleanHere = max(cleanHere, uMaskFlags[m].w);
    }
    if (cleanHere > 0.0) behind = cleanHere * leanEdgeBehind(clamp(basePx / uBaseSize, vec2(0.0), vec2(1.0)), here, back);
  }
  if (w <= 0.0 && behind <= 0.01) return;
  vec2 srcUv = (g0.xy - uImageOffset) / uBaseSize;
  vec3 col = textureLod(uBase, streakUv(srcUv), baseLod).rgb;
  // In perspective a pixel here covers a wider stretch across the lines at
  // its source: read across it, or the source's detail aliases into stripes.
  vec4 v = uStreakVanish[i];
  if (v.w != 0.0 && uStreakPathInfo[i].y < 2.0) {
    vec2 q = toShapeUnits(printPx);
    vec2 sq = toShapeUnits(g0.xy);
    vec2 away = sq - v.xy;
    float spread = mix(1.0, length(away) / max(length(q - v.xy), 1e-5), uStreakAmount);
    if (spread > 1.25) {
      vec2 acrossDir = normalize(vec2(-away.y, away.x)) * uShapeUnit;
      float width = spread * max(1.0, exp2(baseLod));
      int n = int(clamp(ceil(spread * 1.5), 2.0, 8.0));
      vec3 sum = vec3(0.0);
      for (int k = 0; k < 8; k++) {
        if (k >= n) break;
        vec2 at2 = g0.xy + normalize(acrossDir) * ((float(k) + 0.5) / float(n) - 0.5) * width;
        sum += textureLod(uBase, streakUv((at2 - uImageOffset) / uBaseSize), baseLod).rgb;
      }
      col = sum / float(n);
    }
  }
  // Repeat: the repeated stretch's detail on the smear, and the copy itself near the bar's start.
  if (uStreakRepeat[i].x > 0.5 && carryCopy > 0.0) {
    float pull = uStreakEdge[i].y;
    vec3 rr = repeatRead(i, g1.x, g1.y);
    vec2 e1 = mix(printPx, fromShapeUnits(LEAN_POS(i, vec2(rr.x - pull, lineT))), uStreakAmount);
    vec2 e2 = mix(printPx, fromShapeUnits(LEAN_POS(i, vec2(rr.y - pull, lineT))), uStreakAmount);
    vec4 r2 = uStreakRepeat2[i];
    float detail = r2.x * mix(1.0, 0.2, t) * carryCopy;
    float copy = (r2.w >= 0.999 ? 1.0 : r2.w > 0.0 ? 1.0 - smoothstep(r2.w * 0.35, r2.w, t) : 0.0) * carryCopy;
    vec2 eUv = streakUv((e1 - uImageOffset) / uBaseSize);
    vec3 e = textureLod(uBase, eUv, baseLod).rgb;
    vec3 soft = textureLod(uBase, eUv, max(r2.z, baseLod + 1.0)).rgb;
    if (rr.z > 0.0) {
      vec2 bUv = streakUv((e2 - uImageOffset) / uBaseSize);
      e = mix(e, textureLod(uBase, bUv, baseLod).rgb, rr.z);
      soft = mix(soft, textureLod(uBase, bUv, max(r2.z, baseLod + 1.0)).rgb, rr.z);
    }
    col = clamp(col + clamp(e - soft, -0.22, 0.22) * detail, 0.0, 1.0);
    if (copy > 0.0) col = mix(col, e, copy);
  }
  // Its colours: picked by where this colour sits between the darkest and
  // lightest of the lines it borrows from (a few of them, read at the same
  // depth), so the bars keep their pattern of light and dark in them.
  // Blending in from both sides: the far side's copy, fading in over the middle.
  if (fixAt >= 0 && uFixSpan[fixAt].w < 0.5 && g2.w > 0.0)
    col = mix(col, textureLod(uBase, streakUv((g2.xy - uImageOffset) / uBaseSize), baseLod).rgb, g2.w);
  // Recoloured: by where each colour sits between the darkest and lightest
  // of the stretch's own lines (a few, read at the same depth).
  if (fixAt >= 0 && uFixSpan[fixAt].w > 0.5 && uFixSpan[fixAt].w < 1.5 && uFixInfo[fixAt].z > 0.5) {
    vec4 span = uFixSpan[fixAt];
    float lo = 1.0;
    float hi = 0.0;
    for (int c = 0; c < 8; c++) {
      float tc = mix(span.y, span.z, (float(c) + 0.5) / 8.0);
      vec2 pc = fromShapeUnits(LEAN_POS(i, vec2(g2.x, tc)));
      float lc = dot(textureLod(uBase, streakUv((pc - uImageOffset) / uBaseSize), baseLod + 1.0).rgb, W);
      lo = min(lo, lc);
      hi = max(hi, lc);
    }
    int n = int(uFixInfo[fixAt].z + 0.5);
    float pp = clamp((dot(col, W) - lo) / max(hi - lo, 0.02), 0.0, 1.0);
    vec3 c;
    if (n <= 1) {
      c = uFixColours[fixAt * ${MAX_FIX_COLOURS}] * mix(0.7, 1.25, pp);
    } else {
      float xx = pp * float(n - 1);
      int a = min(int(floor(xx)), n - 2);
      c = mix(uFixColours[fixAt * ${MAX_FIX_COLOURS} + a], uFixColours[fixAt * ${MAX_FIX_COLOURS} + a + 1], xx - float(a));
    }
    col = mix(col, clamp(c, 0.0, 1.0), uStreakAmount);
  }
  if (tone.xy != vec2(0.0)) {
    col = linearToSrgb(srgbToLinear(col) * exp2(tone.x));
    col = clamp((col - 0.5) * (1.0 + tone.y) + 0.5, 0.0, 1.0);
  }
  vec3 base = w < 1.0 ? mix(here, col, w) : col;
  if (behind > 0.01) {
    vec3 cleaned = linearToSrgb(clamp(srgbToLinear(here) + behind * under * (srgbToLinear(col) - back), 0.0, 1.0));
    base = w > 0.0 ? mix(cleaned, col, w) : cleaned;
    w += (1.0 - w) * behind * under;
  }
  // The prism: red's and blue's own reads a little to either side across the
  // bars, from the streaks found there (the neighbouring pixels' draws).
  if (uPrism > 0.0 && uLinePass != 2) {
    vec2 flow = g0.xy - printPx;
    flow = dot(flow, flow) > 4.0 ? normalize(flow) : normalize(uStreakInfo[i].zw + vec2(1e-6, 0.0));
    vec2 acrossBars = vec2(-flow.y, flow.x);
    vec2 fringe = split + (uPrismTurn.x * acrossBars + uPrismTurn.y * flow) * uPrism * 0.5;
    if (dot(fringe, fringe) > 0.01) {
      ivec2 size = textureSize(uMatteBack, 0) - 1;
      ivec2 atR = clamp(at - ivec2(fringe * perPx * sign(uRegionSize)), ivec2(0), size);
      ivec2 atB = clamp(at + ivec2(fringe * perPx * sign(uRegionSize)), ivec2(0), size);
      vec4 gr = texelFetch(uMatteBack, atR, 0);
      vec4 gb = texelFetch(uMatteBack, atB, 0);
      // Their weights as shown: the section's masks kept apart in their index (see the geometry draws).
      float iR = texelFetch(uMatteFore, atR, 0).w;
      float iB = texelFetch(uMatteFore, atB, 0).w;
      gr.z *= clamp((iR - floor(iR)) * 2.0, 0.0, 1.0);
      gb.z *= clamp((iB - floor(iB)) * 2.0, 0.0, 1.0);
      vec3 r = textureLod(uBase, streakUv((basePx - fringe) / uBaseSize), baseLod).rgb;
      vec3 b = textureLod(uBase, streakUv((basePx + fringe) / uBaseSize), baseLod).rgb;
      if (gr.z > 0.0) r = mix(r, textureLod(uBase, streakUv((gr.xy - uImageOffset) / uBaseSize), baseLod).rgb, clamp(gr.z, 0.0, 1.0));
      if (gb.z > 0.0) b = mix(b, textureLod(uBase, streakUv((gb.xy - uImageOffset) / uBaseSize), baseLod).rgb, clamp(gb.z, 0.0, 1.0));
      float l = dot(base, W);
      fringeLum = vec2(dot(r, W) - l, dot(b, W) - l);
    }
  }
  outColor = vec4(base, w);
  outUv = vec4(srcUv, pack12(fringeLum, 2047.0), pack12(lightShift, 1.0));
}
`
