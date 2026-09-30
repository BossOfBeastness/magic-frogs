/* Magic Frogs prototype, core B art: global Art.
   Art direction v2 (Slay the Spire meets Gun Hero): goofy round Gun Hero characters,
   big eyes, thick dark outlines, but every body gets 2 to 3 tone cel shading (base fill,
   a darker crescent away from a top-left light, a small top-left highlight), against
   moodier dusk backgrounds. Canvas 2D paths only, no images. (ctx, x, y, s, ...):
   (x, y) is the ground point in canvas pixels, s is the figure's height in pixels. */
(function (root) {
  'use strict';

  const COLORS = {
    ink: '#241B3A',
    sky: '#7FD6FF', sky2: '#D8F6FF',
    grass: '#8FDB54', grass2: '#63B83A',
    bog: '#5FA88E',
    road: '#6F6A93', road2: '#858AB0', dash: '#FFF3C4',
    good: '#2F86FF', bad: '#FF4D63', gold: '#FFC23D',
    fire: '#FF7A2F', ice: '#6FE3FF', poison: '#8CFF3F', blast: '#C35CFF', storm: '#FFE14A', arcane: '#FF7BD5',
    panel: '#FFF7E8', panel2: '#FFE7B8',
    go: '#54D63A', goShade: '#2F9C1E',
    ad: '#B44DFF', adShade: '#7F24C9',
    buy: '#FFB020', buyShade: '#D98300',
    coin: '#FFC93C', gem: '#3FE0FF',
    frame: '#1A1330',
    tier1: '#D8DCE8', tier2: '#6EE06A', tier3: '#4FA8FF', tier4: '#B266FF', tier5: '#FFC23D',
    skinLeaf: '#6DD35A', skinLime: '#A8E04A', skinTeal: '#3CC7B0', skinGold: '#F5C542',
    robe: '#4A56C9', hatBand: '#FFC23D',
    ratRunt: '#8E7BB8', ratBrute: '#7A6A9E', ratTank: '#5E5378', ratBelly: '#CFC3EA', ratEar: '#F7A8C8', ratEye: '#A6FF3C',
    // dusk bog (v2)
    duskSkyTop: '#2E3A5C', duskSkyBot: '#6A5A8C', duskGlow: '#F2A65A',
    fog: '#B8C6D9',
    boggrass: '#4E7A4A', boggrassShade: '#35573A', bogwater: '#3F6E6A',
    slate: '#262A3D', slateRaised: '#34395A', goldTrim: '#C9A34A', parchment: '#EAD9B0',
  };

  const TIER_COLOR = [null, COLORS.tier1, COLORS.tier2, COLORS.tier3, COLORS.tier4, COLORS.tier5];

  function lw(s) { return Math.max(1.5, s / 28); }

  // ---- colour helpers for cel shading --------------------------------------

  function hexToRgb(hex) {
    const h = hex.replace('#', '');
    return [parseInt(h.substr(0, 2), 16), parseInt(h.substr(2, 2), 16), parseInt(h.substr(4, 2), 16)];
  }
  function rgbToHex(r, g, b) {
    const c = v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
    return '#' + c(r) + c(g) + c(b);
  }
  function darken(hex, amt) {
    const [r, g, b] = hexToRgb(hex);
    return rgbToHex(r * (1 - amt), g * (1 - amt), b * (1 - amt));
  }
  function lighten(hex, amt) {
    const [r, g, b] = hexToRgb(hex);
    return rgbToHex(r + (255 - r) * amt, g + (255 - g) * amt, b + (255 - b) * amt);
  }

  function unevenLine(baseWidth, seedX, seedY) {
    return baseWidth * (1 + 0.14 * Math.sin(seedX * 12.9 + seedY * 7.7));
  }

  // Fills drawPath(ctx) with cel shading (base, darker crescent bottom-right, small
  // top-left highlight, uneven ink outline), given an approximate bounding box for
  // placing the shadow/highlight blobs. bx,by is the box's centre.
  function shadedFill(ctx, drawPath, base, bx, by, bw, bh, strokeW) {
    drawPath(ctx);
    ctx.fillStyle = base;
    ctx.fill();
    ctx.save();
    drawPath(ctx);
    ctx.clip();
    ctx.beginPath();
    ctx.ellipse(bx + bw * 0.30, by + bh * 0.30, bw * 0.72, bh * 0.72, 0, 0, Math.PI * 2);
    ctx.fillStyle = darken(base, 0.25);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(bx - bw * 0.28, by - bh * 0.30, bw * 0.30, bh * 0.24, 0, 0, Math.PI * 2);
    ctx.fillStyle = lighten(base, 0.30);
    ctx.fill();
    ctx.restore();
    drawPath(ctx);
    ctx.strokeStyle = COLORS.ink;
    ctx.lineWidth = unevenLine(strokeW, bx, by);
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.stroke();
  }

  function shadedEllipse(ctx, cx, cy, rx, ry, base, strokeW) {
    shadedFill(ctx, c => {
      c.beginPath();
      c.ellipse(cx, cy, Math.max(0.01, rx), Math.max(0.01, ry), 0, 0, Math.PI * 2);
    }, base, cx, cy, rx, ry, strokeW);
  }

  function outline(ctx, s) {
    ctx.strokeStyle = COLORS.ink;
    ctx.lineWidth = lw(s);
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
  }

  function ellipse(ctx, cx, cy, rx, ry, fill) {
    ctx.beginPath();
    ctx.ellipse(cx, cy, Math.max(0.01, rx), Math.max(0.01, ry), 0, 0, Math.PI * 2);
    if (fill) { ctx.fillStyle = fill; ctx.fill(); }
    ctx.stroke();
  }

  function circle(ctx, cx, cy, r, fill) { ellipse(ctx, cx, cy, r, r, fill); }

  // ---- frogs ----------------------------------------------------------

  // Profile hero for core B, facing right. s = height in pixels; (x, y) is the
  // ground point under the feet. Everything, hat included, fits between y - s and y.
  // setColor/RARITY_COLOR are shared by the gear-tinted frogs and Art.gearIcon.
  const RARITY_COLOR = { common: '#D8DCE8', rare: '#4FA8FF', epic: '#B266FF', legendary: '#FFC23D' };
  function setColor(setId, fallback) {
    try { if (root.Meta && root.Meta.SETS && root.Meta.SETS[setId]) return root.Meta.SETS[setId].color; } catch (e) { /* Meta not loaded yet */ }
    return fallback;
  }

  // gear: optional { hat: setId|null, robe: setId|null }. When given, tints the hat
  // and/or cape/robe with that set's colour (Meta.SETS[set].color); old callers that
  // omit it keep drawing the plain hat/robe colours passed in.
  function frogSide(ctx, x, y, s, skin, hat, gem, t, casting, gear) {
    ctx.save();
    const hatColor = gear && gear.hat ? setColor(gear.hat, hat) : hat;
    const robeColor = gear && gear.robe ? setColor(gear.robe, COLORS.robe) : COLORS.robe;
    const hop = Math.sin(t * 8) * s * 0.02;
    const yy = y - hop;

    // back leg: folded thigh, flat foot, toe bumps
    outline(ctx, s);
    ctx.save();
    ctx.translate(x - s * 0.16, yy - s * 0.12);
    ctx.rotate(-0.3);
    ellipse(ctx, 0, 0, s * 0.15, s * 0.11, darken(skin, 0.12));
    ctx.restore();
    ellipse(ctx, x - s * 0.02, yy - s * 0.03, s * 0.14, s * 0.035, darken(skin, 0.12));
    for (const dx of [-0.10, -0.02, 0.06]) {
      circle(ctx, x + dx * s, yy - s * 0.065, s * 0.025, darken(skin, 0.12));
    }

    // body + head, one silhouette, cel shaded (no stacked circles, no neck)
    shadedFill(ctx, c => {
      c.beginPath();
      c.ellipse(x, yy - s * 0.26, s * 0.30, s * 0.24, 0, 0, Math.PI * 2);
      c.ellipse(x + s * 0.10, yy - s * 0.42, s * 0.24, s * 0.17, 0, 0, Math.PI * 2);
    }, skin, x + s * 0.04, yy - s * 0.32, s * 0.28, s * 0.28, lw(s));

    // belly
    ellipse(ctx, x + s * 0.12, yy - s * 0.20, s * 0.14, s * 0.13, lighten(skin, 0.45));

    // cape: short, from behind the head draping over the back
    ctx.beginPath();
    ctx.moveTo(x - s * 0.04, yy - s * 0.50);
    ctx.quadraticCurveTo(x - s * 0.26, yy - s * 0.34, x - s * 0.30, yy - s * 0.12);
    ctx.quadraticCurveTo(x - s * 0.16, yy - s * 0.18, x - s * 0.10, yy - s * 0.34);
    ctx.closePath();
    ctx.fillStyle = robeColor;
    ctx.fill();
    outline(ctx, s);
    ctx.stroke();

    // front arm: a small capsule from the shoulder to the hand
    const armX0 = x + s * 0.20, armY0 = yy - s * 0.26;
    const armX1 = x + s * 0.30, armY1 = yy - s * 0.25;
    ctx.beginPath();
    ctx.moveTo(armX0, armY0);
    ctx.lineTo(armX1, armY1);
    ctx.strokeStyle = skin;
    ctx.lineCap = 'round';
    ctx.lineWidth = s * 0.13;
    ctx.stroke();
    outline(ctx, s);
    ctx.beginPath();
    ctx.moveTo(armX0, armY0);
    ctx.lineTo(armX1, armY1);
    ctx.lineWidth = lw(s) * 0.9;
    ctx.stroke();
    circle(ctx, armX1, armY1, s * 0.07, skin);

    // eye dome on top of the head
    const ex = x + s * 0.13, ey = yy - s * 0.58;
    circle(ctx, ex, ey, s * 0.085, skin);
    circle(ctx, ex, ey, s * 0.062, '#fff');
    ellipse(ctx, ex + s * 0.02, ey, s * 0.035, s * 0.02, COLORS.ink);
    circle(ctx, ex + s * 0.03, ey - s * 0.015, s * 0.012, '#fff');

    // mouth: one long ink curve, smiling
    outline(ctx, s);
    ctx.beginPath();
    ctx.moveTo(x + s * 0.33, yy - s * 0.40);
    ctx.quadraticCurveTo(x + s * 0.18, yy - s * 0.28, x + s * 0.02, yy - s * 0.37);
    ctx.stroke();

    // pink cheek
    circle(ctx, x + s * 0.18, yy - s * 0.45, s * 0.04, 'rgba(255,120,150,0.55)');

    // hat: brim, cone bent back to a tip, gold star band
    const bx = x + s * 0.02, by = yy - s * 0.60;
    ctx.beginPath();
    ctx.ellipse(bx, by, s * 0.17, s * 0.04, 0, 0, Math.PI * 2);
    ctx.fillStyle = hatColor;
    ctx.fill();
    outline(ctx, s);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(bx - s * 0.12, by - s * 0.01);
    ctx.quadraticCurveTo(bx - s * 0.24, yy - s * 0.80, x - s * 0.10, yy - s * 0.97);
    ctx.quadraticCurveTo(bx + s * 0.04, yy - s * 0.76, bx + s * 0.13, by - s * 0.01);
    ctx.closePath();
    ctx.fillStyle = hatColor;
    ctx.fill();
    ctx.fillStyle = darken(hatColor, 0.25);
    ctx.beginPath();
    ctx.moveTo(bx + s * 0.02, by - s * 0.12);
    ctx.quadraticCurveTo(bx, yy - s * 0.80, x - s * 0.10, yy - s * 0.97);
    ctx.quadraticCurveTo(bx + s * 0.04, yy - s * 0.76, bx + s * 0.13, by - s * 0.01);
    ctx.closePath();
    ctx.fill();
    outline(ctx, s);
    ctx.beginPath();
    ctx.moveTo(bx - s * 0.12, by - s * 0.01);
    ctx.quadraticCurveTo(bx - s * 0.24, yy - s * 0.80, x - s * 0.10, yy - s * 0.97);
    ctx.quadraticCurveTo(bx + s * 0.04, yy - s * 0.76, bx + s * 0.13, by - s * 0.01);
    ctx.closePath();
    ctx.stroke();
    ctx.fillStyle = COLORS.hatBand;
    ctx.beginPath();
    ctx.ellipse(bx, by - s * 0.03, s * 0.155, s * 0.03, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // staff: wood line from the hand to the tip, gem, glow and forward tilt while casting
    const handX = armX1, handY = armY1;
    let tipX = x + s * 0.52, tipY = yy - s * 0.62;
    if (casting) {
      const ang = Math.atan2(tipY - handY, tipX - handX) - 0.2;
      const dist = Math.hypot(tipX - handX, tipY - handY);
      tipX = handX + Math.cos(ang) * dist;
      tipY = handY + Math.sin(ang) * dist;
    }
    ctx.beginPath();
    ctx.moveTo(handX, handY);
    ctx.lineTo(tipX, tipY);
    ctx.strokeStyle = '#7A5230';
    ctx.lineWidth = lw(s) * 1.4;
    ctx.stroke();
    if (casting) {
      ctx.fillStyle = 'rgba(255,255,255,0.4)';
      circle(ctx, tipX, tipY, s * 0.13, 'rgba(255,255,255,0.4)');
    }
    outline(ctx, s);
    circle(ctx, tipX, tipY, s * 0.05, gem);
    ctx.restore();
  }

  // Portrait / title frog, front facing.
  function frogFront(ctx, x, y, s, skin, hat, robe, t, species, gear) {
    ctx.save();
    const hatColor = gear && gear.hat ? setColor(gear.hat, hat) : hat;
    const robeColor = gear && gear.robe ? setColor(gear.robe, robe || COLORS.robe) : (robe || COLORS.robe);
    outline(ctx, s);
    const hop = Math.sin(t * 6) * s * 0.02;
    const cy = y - s * 0.5 - hop;
    let fillSkin = skin;
    if (species === 'bullfrog') fillSkin = '#7FA650';
    else if (species === 'golden') fillSkin = COLORS.gold;
    else if (species === 'toad') fillSkin = '#A07850';
    else if (species === 'dart') fillSkin = '#3F8CFF';
    else if (species === 'bw') fillSkin = '#2B2540';
    // body (shaded)
    shadedEllipse(ctx, x, cy + s * 0.16, s * 0.36, s * 0.32, fillSkin, lw(s));
    // robe
    ctx.beginPath();
    ctx.moveTo(x - s * 0.32, cy + s * 0.26);
    ctx.quadraticCurveTo(x, cy + s * 0.5, x + s * 0.32, cy + s * 0.26);
    ctx.lineTo(x + s * 0.26, cy + s * 0.06);
    ctx.quadraticCurveTo(x, cy + s * 0.16, x - s * 0.26, cy + s * 0.06);
    ctx.closePath();
    ctx.fillStyle = robeColor;
    ctx.fill();
    ctx.fillStyle = darken(robeColor, 0.22);
    ctx.beginPath();
    ctx.ellipse(x + s * 0.10, cy + s * 0.32, s * 0.16, s * 0.10, 0, 0, Math.PI * 2);
    ctx.fill();
    outline(ctx, s);
    ctx.beginPath();
    ctx.moveTo(x - s * 0.32, cy + s * 0.26);
    ctx.quadraticCurveTo(x, cy + s * 0.5, x + s * 0.32, cy + s * 0.26);
    ctx.lineTo(x + s * 0.26, cy + s * 0.06);
    ctx.quadraticCurveTo(x, cy + s * 0.16, x - s * 0.26, cy + s * 0.06);
    ctx.closePath();
    ctx.stroke();
    // head (shaded)
    const hy = cy - s * 0.22;
    shadedEllipse(ctx, x, hy, s * 0.30, s * 0.26, fillSkin, lw(s));
    // two eye domes
    const eR = s * 0.155, eyDy = hy - s * 0.22;
    for (const dx of [-1, 1]) {
      const eyx = x + dx * s * 0.16;
      shadedEllipse(ctx, eyx, eyDy, eR, eR, fillSkin, lw(s));
      let pupil = COLORS.ink;
      if (species === 'tree') pupil = '#FF8A2F';
      circle(ctx, eyx, eyDy, eR * 0.55, '#fff');
      circle(ctx, eyx + dx * s * 0.01, eyDy, eR * 0.28, pupil);
    }
    // species marks
    if (species === 'toad') {
      for (const [dx, dy] of [[-0.14, 0.05], [0.10, -0.05], [0.16, 0.10], [-0.05, 0.14]]) {
        circle(ctx, x + dx * s, hy + dy * s, s * 0.03, '#6E5638');
      }
    }
    if (species === 'dart') {
      for (const [dx, dy] of [[-0.15, 0.08], [0.12, -0.02], [0.02, 0.16], [-0.02, -0.12]]) {
        circle(ctx, x + dx * s, hy + dy * s, s * 0.025, COLORS.ink);
      }
    }
    if (species === 'bw') {
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.ellipse(x - s * 0.02, hy + s * 0.14, s * 0.14, s * 0.09, 0.3, 0, Math.PI * 2);
      ctx.fill();
      outline(ctx, s);
      ctx.stroke();
    }
    // pink cheeks
    circle(ctx, x - s * 0.20, hy + s * 0.10, s * 0.06, 'rgba(255,120,150,0.55)');
    circle(ctx, x + s * 0.20, hy + s * 0.10, s * 0.06, 'rgba(255,120,150,0.55)');
    // smile
    outline(ctx, s);
    ctx.beginPath();
    ctx.arc(x, hy + s * 0.10, s * 0.14, 0.1 * Math.PI, 0.9 * Math.PI);
    ctx.stroke();
    // hat
    if (hat) {
      ctx.beginPath();
      ctx.moveTo(x - s * 0.18, eyDy - s * 0.10);
      ctx.lineTo(x + s * 0.02, eyDy - s * 0.58);
      ctx.lineTo(x + s * 0.20, eyDy - s * 0.06);
      ctx.closePath();
      ctx.fillStyle = hatColor;
      ctx.fill();
      ctx.fillStyle = darken(hatColor, 0.25);
      ctx.beginPath();
      ctx.moveTo(x + s * 0.02, eyDy - s * 0.30);
      ctx.lineTo(x + s * 0.02, eyDy - s * 0.58);
      ctx.lineTo(x + s * 0.20, eyDy - s * 0.06);
      ctx.lineTo(x + s * 0.06, eyDy - s * 0.08);
      ctx.closePath();
      ctx.fill();
      outline(ctx, s);
      ctx.beginPath();
      ctx.moveTo(x - s * 0.18, eyDy - s * 0.10);
      ctx.lineTo(x + s * 0.02, eyDy - s * 0.58);
      ctx.lineTo(x + s * 0.20, eyDy - s * 0.06);
      ctx.closePath();
      ctx.stroke();
      ctx.fillStyle = COLORS.hatBand;
      ctx.beginPath();
      ctx.moveTo(x - s * 0.15, eyDy - s * 0.14);
      ctx.lineTo(x + s * 0.17, eyDy - s * 0.12);
      ctx.lineTo(x + s * 0.15, eyDy - s * 0.02);
      ctx.lineTo(x - s * 0.13, eyDy - s * 0.04);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }
    ctx.restore();
  }

  // ---- rats -------------------------------------------------------------

  function ratStatus(ctx, x, y, s, status) {
    if (!status) return;
    if (status.burnT > 0) {
      ctx.fillStyle = COLORS.fire;
      for (const dx of [-0.12, 0.04, 0.16]) {
        ctx.beginPath();
        ctx.moveTo(x + dx * s, y - s * 0.85);
        ctx.quadraticCurveTo(x + dx * s + s * 0.04, y - s * 1.05, x + dx * s, y - s * 1.2);
        ctx.quadraticCurveTo(x + dx * s - s * 0.04, y - s * 1.05, x + dx * s, y - s * 0.85);
        ctx.fill();
      }
    }
    if (status.slowT > 0) {
      ctx.save();
      ctx.strokeStyle = COLORS.ice;
      ctx.lineWidth = Math.max(1.5, s / 20);
      ctx.globalAlpha = 0.7;
      ctx.beginPath();
      ctx.ellipse(x, y, s * 0.32, s * 0.10, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
    if (status.poisT > 0) {
      ctx.fillStyle = 'rgba(140,255,63,0.7)';
      for (const [dx, dy] of [[-0.1, 0.1], [0.08, 0.3], [0.02, 0.5]]) {
        circle(ctx, x + dx * s, y - s * 0.6 - dy * s, s * 0.04, 'rgba(140,255,63,0.7)');
      }
    }
  }

  function ratSide(ctx, x, y, s, kind, t, status) {
    ctx.save();
    outline(ctx, s);
    const bob = Math.sin(t * 10) * s * 0.03;
    const cy = y - s * 0.34 - bob;
    let body = COLORS.ratRunt;
    if (kind === 'brute') body = COLORS.ratBrute;
    else if (kind === 'tank') body = COLORS.ratTank;
    // tail
    ctx.beginPath();
    ctx.moveTo(x + s * 0.30, y - s * 0.10);
    ctx.quadraticCurveTo(x + s * 0.55, y - s * 0.20 + bob, x + s * 0.50, y - s * 0.02);
    ctx.lineWidth = lw(s) * 0.8;
    ctx.strokeStyle = COLORS.ink;
    ctx.stroke();
    // pear body (walking left, so nose/head to the left), shaded
    shadedEllipse(ctx, x + s * 0.06, cy + s * 0.10, s * 0.30, s * 0.24, body, lw(s));
    // belly
    ellipse(ctx, x + s * 0.02, cy + s * 0.20, s * 0.16, s * 0.12, COLORS.ratBelly);
    // head, shaded
    const hx = x - s * 0.24, hy = cy - s * 0.02;
    shadedEllipse(ctx, hx, hy, s * 0.20, s * 0.18, body, lw(s));
    // ear
    circle(ctx, hx + s * 0.02, hy - s * 0.18, s * 0.09, COLORS.ratEar);
    // eye
    circle(ctx, hx - s * 0.06, hy - s * 0.02, s * 0.05, COLORS.ratEye);
    // buck teeth
    ctx.fillStyle = '#fff';
    ctx.fillRect(hx - s * 0.24, hy + s * 0.06, s * 0.05, s * 0.09);
    ctx.strokeRect(hx - s * 0.24, hy + s * 0.06, s * 0.05, s * 0.09);
    // legs
    const legShift = Math.sin(t * 10) * s * 0.06;
    ellipse(ctx, x - s * 0.06 + legShift, y - s * 0.04, s * 0.09, s * 0.07, darken(body, 0.15));
    ellipse(ctx, x + s * 0.18 - legShift, y - s * 0.04, s * 0.09, s * 0.07, darken(body, 0.15));
    // kind extras
    if (kind === 'brute') {
      ctx.fillStyle = '#EFE6D8';
      ctx.beginPath();
      ctx.ellipse(hx + s * 0.02, hy + s * 0.06, s * 0.14, s * 0.06, -0.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
    if (kind === 'tank') {
      ctx.fillStyle = '#8A8578';
      ctx.beginPath();
      ctx.arc(hx + s * 0.02, hy - s * 0.16, s * 0.16, Math.PI, 0);
      ctx.fill();
      ctx.stroke();
    }
    if (status && status.spitter) {
      circle(ctx, hx - s * 0.20, hy + s * 0.16, s * 0.045, COLORS.poison);
    }
    ratStatus(ctx, x, y, s, status);
    ctx.restore();
  }

  // ---- bosses -------------------------------------------------------------

  function boss(ctx, x, y, s, name, t, side) {
    ctx.save();
    outline(ctx, s);
    const bob = Math.sin(t * 3) * s * 0.02;
    const cy = y - s * 0.5 - bob;
    const dir = side ? -1 : 1; // profile faces left (walking left), mirrored horizontally
    if (name === 'Rat King') {
      shadedEllipse(ctx, x, cy + s * 0.14, s * 0.38, s * 0.34, COLORS.ratTank, lw(s));
      shadedEllipse(ctx, x + dir * s * 0.28, cy - s * 0.04, s * 0.22, s * 0.20, COLORS.ratTank, lw(s));
      // cape
      ctx.fillStyle = COLORS.bad;
      ctx.beginPath();
      ctx.moveTo(x - s * 0.30, cy - s * 0.10);
      ctx.quadraticCurveTo(x, cy + s * 0.55, x + s * 0.30, cy - s * 0.10);
      ctx.lineTo(x + s * 0.18, cy - s * 0.20);
      ctx.lineTo(x - s * 0.18, cy - s * 0.20);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = darken(COLORS.bad, 0.22);
      ctx.beginPath();
      ctx.ellipse(x + s * 0.10, cy + s * 0.28, s * 0.16, s * 0.14, 0, 0, Math.PI * 2);
      ctx.fill();
      outline(ctx, s);
      ctx.beginPath();
      ctx.moveTo(x - s * 0.30, cy - s * 0.10);
      ctx.quadraticCurveTo(x, cy + s * 0.55, x + s * 0.30, cy - s * 0.10);
      ctx.lineTo(x + s * 0.18, cy - s * 0.20);
      ctx.lineTo(x - s * 0.18, cy - s * 0.20);
      ctx.closePath();
      ctx.stroke();
      // crown
      ctx.fillStyle = COLORS.gold;
      const kx = x + dir * s * 0.28, ky = cy - s * 0.24;
      ctx.beginPath();
      ctx.moveTo(kx - s * 0.16, ky);
      ctx.lineTo(kx - s * 0.10, ky - s * 0.16);
      ctx.lineTo(kx, ky - s * 0.02);
      ctx.lineTo(kx + s * 0.10, ky - s * 0.16);
      ctx.lineTo(kx + s * 0.16, ky);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      circle(ctx, kx + dir * s * 0.10, ky + s * 0.02, s * 0.045, COLORS.ratEye);
      // sceptre
      ctx.strokeStyle = '#7A5A3A';
      ctx.lineWidth = lw(s) * 1.4;
      ctx.beginPath();
      ctx.moveTo(x + dir * s * 0.36, cy + s * 0.10);
      ctx.lineTo(x + dir * s * 0.5, cy - s * 0.30);
      ctx.stroke();
      outline(ctx, s);
      circle(ctx, x + dir * s * 0.5, cy - s * 0.34, s * 0.07, COLORS.bad);
    } else if (name === 'Sewer Queen') {
      shadedFill(ctx, c => {
        c.beginPath();
        c.moveTo(x - s * 0.32, cy + s * 0.48);
        c.quadraticCurveTo(x - s * 0.22, cy - s * 0.10, x, cy - s * 0.14);
        c.quadraticCurveTo(x + s * 0.22, cy - s * 0.10, x + s * 0.32, cy + s * 0.48);
        c.closePath();
      }, '#3E7A5C', x, cy + s * 0.18, s * 0.32, s * 0.34, lw(s));
      // drips
      ctx.fillStyle = COLORS.poison;
      for (const dx of [-0.2, 0, 0.2]) {
        circle(ctx, x + dx * s, cy + s * 0.5, s * 0.035, COLORS.poison);
      }
      shadedEllipse(ctx, x + dir * s * 0.24, cy - s * 0.26, s * 0.20, s * 0.19, COLORS.ratBrute, lw(s));
      // tiara
      ctx.fillStyle = COLORS.gold;
      const qx = x + dir * s * 0.24, qy = cy - s * 0.44;
      ctx.beginPath();
      ctx.moveTo(qx - s * 0.14, qy + s * 0.04);
      ctx.lineTo(qx - s * 0.06, qy - s * 0.10);
      ctx.lineTo(qx, qy + s * 0.02);
      ctx.lineTo(qx + s * 0.06, qy - s * 0.10);
      ctx.lineTo(qx + s * 0.14, qy + s * 0.04);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      circle(ctx, qx + dir * s * 0.06, qy - s * 0.28, s * 0.05, COLORS.gem);
      circle(ctx, x + dir * s * 0.18, cy - s * 0.28, s * 0.045, COLORS.ratEye);
    } else {
      // Plague Lord: hooded robe, beaked mask
      shadedFill(ctx, c => {
        c.beginPath();
        c.moveTo(x - s * 0.34, cy + s * 0.48);
        c.quadraticCurveTo(x, cy - s * 0.50, x + s * 0.20, cy - s * 0.42);
        c.quadraticCurveTo(x + s * 0.34, cy + s * 0.10, x + s * 0.34, cy + s * 0.48);
        c.closePath();
      }, '#4A3A5E', x, cy + s * 0.10, s * 0.34, s * 0.44, lw(s));
      // mask
      shadedEllipse(ctx, x + dir * s * 0.06, cy - s * 0.30, s * 0.18, s * 0.16, '#D8D2C4', lw(s));
      ctx.fillStyle = '#D8D2C4';
      ctx.beginPath();
      ctx.moveTo(x + dir * s * 0.18, cy - s * 0.30);
      ctx.lineTo(x + dir * s * 0.40, cy - s * 0.24);
      ctx.lineTo(x + dir * s * 0.18, cy - s * 0.20);
      ctx.closePath();
      ctx.fill();
      outline(ctx, s);
      ctx.stroke();
      ctx.fillStyle = COLORS.poison;
      circle(ctx, x + dir * s * 0.02, cy - s * 0.32, s * 0.05, COLORS.poison);
    }
    ctx.restore();
  }

  // ---- ingredients, keg, glob, bolt ---------------------------------------

  function pips(ctx, x, y, s, tier, color) {
    const n = tier || 1;
    const rr = s * 0.045;
    const totalW = (n - 1) * s * 0.14;
    for (let i = 0; i < n; i++) {
      circle(ctx, x - totalW / 2 + i * s * 0.14, y + s * 0.44, rr, color || COLORS.ink);
    }
  }

  function ingredient(ctx, x, y, s, type, tier) {
    ctx.save();
    outline(ctx, s);
    const rim = TIER_COLOR[tier] || TIER_COLOR[1];
    // rim ring behind everything
    circle(ctx, x, y - s * 0.02, s * 0.46, rim);
    const cy = y - s * 0.04;
    if (type === 'ember') {
      // jar with orange salt crystal and flame
      shadedFill(ctx, c => { c.rect(x - s * 0.16, cy - s * 0.10, s * 0.32, s * 0.30); },
        '#D8E8F0', x, cy + s * 0.05, s * 0.16, s * 0.15, lw(s));
      ctx.fillStyle = COLORS.fire;
      ctx.beginPath();
      ctx.moveTo(x, cy - s * 0.20);
      ctx.quadraticCurveTo(x + s * 0.10, cy - s * 0.06, x, cy + s * 0.06);
      ctx.quadraticCurveTo(x - s * 0.10, cy - s * 0.06, x, cy - s * 0.20);
      ctx.fill();
      ctx.stroke();
      circle(ctx, x + s * 0.05, cy + s * 0.16, s * 0.03, '#FFB870');
    } else if (type === 'frost') {
      shadedEllipse(ctx, x, cy + s * 0.02, s * 0.14, s * 0.22, COLORS.ice, lw(s));
    } else if (type === 'shade') {
      ctx.strokeStyle = '#3E6B3E';
      ctx.lineWidth = lw(s) * 1.2;
      ctx.beginPath();
      ctx.moveTo(x, cy + s * 0.20);
      ctx.lineTo(x, cy - s * 0.16);
      ctx.stroke();
      outline(ctx, s);
      for (const [dx, dy] of [[-0.08, -0.10], [0.08, -0.02], [-0.04, 0.10]]) {
        shadedEllipse(ctx, x + dx * s, cy + dy * s, s * 0.08, s * 0.08, '#4A2F6B', lw(s) * 0.8);
      }
    } else if (type === 'blast') {
      shadedFill(ctx, c => {
        c.beginPath();
        c.moveTo(x - s * 0.16, cy + s * 0.20);
        c.quadraticCurveTo(x - s * 0.20, cy - s * 0.10, x, cy - s * 0.16);
        c.quadraticCurveTo(x + s * 0.20, cy - s * 0.10, x + s * 0.16, cy + s * 0.20);
        c.closePath();
      }, COLORS.blast, x, cy + s * 0.04, s * 0.18, s * 0.20, lw(s));
      ctx.strokeStyle = '#7A5A3A';
      ctx.beginPath();
      ctx.moveTo(x + s * 0.02, cy - s * 0.16);
      ctx.lineTo(x + s * 0.08, cy - s * 0.30);
      ctx.stroke();
      ctx.fillStyle = COLORS.fire;
      circle(ctx, x + s * 0.08, cy - s * 0.32, s * 0.03, COLORS.fire);
    } else if (type === 'storm') {
      ctx.fillStyle = COLORS.storm;
      ctx.beginPath();
      ctx.moveTo(x, cy - s * 0.22);
      ctx.quadraticCurveTo(x + s * 0.14, cy - s * 0.06, x + s * 0.04, cy);
      ctx.quadraticCurveTo(x + s * 0.16, cy + s * 0.10, x, cy + s * 0.22);
      ctx.quadraticCurveTo(x - s * 0.10, cy, x, cy - s * 0.22);
      ctx.fill();
      ctx.stroke();
    } else if (type === 'moon') {
      ctx.fillStyle = '#C9A8E8';
      ctx.beginPath();
      ctx.moveTo(x - s * 0.14, cy + s * 0.20);
      ctx.lineTo(x + s * 0.14, cy + s * 0.20);
      ctx.lineTo(x + s * 0.08, cy - s * 0.02);
      ctx.lineTo(x - s * 0.08, cy - s * 0.02);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#E8D8F5';
      ctx.beginPath();
      ctx.arc(x, cy - s * 0.10, s * 0.14, 0.7 * Math.PI, 1.7 * Math.PI);
      ctx.arc(x + s * 0.06, cy - s * 0.10, s * 0.10, 1.7 * Math.PI, 0.7 * Math.PI, true);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    } else if (type === 'quick') {
      shadedFill(ctx, c => {
        c.beginPath();
        c.moveTo(x, cy - s * 0.22);
        c.quadraticCurveTo(x + s * 0.16, cy + s * 0.02, x, cy + s * 0.22);
        c.quadraticCurveTo(x - s * 0.16, cy + s * 0.02, x, cy - s * 0.22);
      }, '#C8CDE0', x, cy, s * 0.16, s * 0.22, lw(s));
    } else if (type === 'dew') {
      // a small green lily pad with a notch, and a pale blue water drop resting on it
      ctx.fillStyle = '#3E8C4A';
      ctx.beginPath();
      ctx.arc(x, cy + s * 0.14, s * 0.22, 0.22, Math.PI * 2 - 0.22);
      ctx.lineTo(x, cy + s * 0.14);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#6FE3FF';
      ctx.beginPath();
      ctx.moveTo(x, cy - s * 0.20);
      ctx.quadraticCurveTo(x + s * 0.10, cy - s * 0.04, x, cy + s * 0.08);
      ctx.quadraticCurveTo(x - s * 0.10, cy - s * 0.04, x, cy - s * 0.20);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = 'rgba(255,255,255,0.6)';
      circle(ctx, x - s * 0.03, cy - s * 0.10, s * 0.02, 'rgba(255,255,255,0.6)');
    } else if (type === 'spawn') {
      for (const [dx, dy] of [[-0.10, 0.08], [0.10, 0.06], [0, -0.08], [-0.04, -0.2]]) {
        ctx.fillStyle = 'rgba(230,245,255,0.85)';
        circle(ctx, x + dx * s, cy + dy * s, s * 0.11, 'rgba(230,245,255,0.85)');
        ctx.fillStyle = COLORS.ink;
        circle(ctx, x + dx * s + s * 0.02, cy + dy * s, s * 0.03, COLORS.ink);
      }
    }
    pips(ctx, x, y, s, tier, COLORS.ink);
    ctx.restore();
  }

  function keg(ctx, x, y, s) {
    ctx.save();
    outline(ctx, s);
    shadedFill(ctx, c => {
      c.beginPath();
      c.moveTo(x - s * 0.30, y - s * 0.30);
      c.quadraticCurveTo(x - s * 0.40, y - s * 0.10, x - s * 0.30, y + s * 0.30);
      c.lineTo(x + s * 0.30, y + s * 0.30);
      c.quadraticCurveTo(x + s * 0.40, y - s * 0.10, x + s * 0.30, y - s * 0.30);
      c.closePath();
    }, '#8A5A3A', x, y, s * 0.32, s * 0.32, lw(s));
    for (const dy of [-0.14, 0.14]) {
      ctx.beginPath();
      ctx.moveTo(x - s * 0.34, y + dy * s);
      ctx.lineTo(x + s * 0.34, y + dy * s);
      ctx.stroke();
    }
    // purple rune
    ctx.fillStyle = COLORS.blast;
    circle(ctx, x, y, s * 0.10, COLORS.blast);
    ctx.restore();
  }

  function glob(ctx, x, y, s, t) {
    ctx.save();
    outline(ctx, s);
    shadedEllipse(ctx, x, y, s * 0.24, s * 0.24, COLORS.poison, lw(s));
    const wob = Math.sin(t * 20) * s * 0.05;
    ctx.beginPath();
    ctx.moveTo(x - s * 0.06, y + s * 0.20);
    ctx.quadraticCurveTo(x, y + s * 0.36 + wob, x + s * 0.06, y + s * 0.20);
    ctx.closePath();
    ctx.fillStyle = COLORS.poison;
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    circle(ctx, x - s * 0.08, y - s * 0.08, s * 0.06, 'rgba(255,255,255,0.5)');
    ctx.restore();
  }

  function bolt(ctx, x, y, s, element, angle, t) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle || 0);
    outline(ctx, s);
    const trailLen = s * 0.9;
    if (element === 'fire') {
      ctx.fillStyle = COLORS.fire;
      circle(ctx, 0, 0, s * 0.18, COLORS.fire);
      ctx.fillStyle = 'rgba(255,122,47,0.4)';
      ctx.beginPath();
      ctx.moveTo(-s * 0.10, -s * 0.10);
      ctx.lineTo(-trailLen, 0);
      ctx.lineTo(-s * 0.10, s * 0.10);
      ctx.closePath();
      ctx.fill();
    } else if (element === 'ice') {
      ctx.fillStyle = COLORS.ice;
      ctx.beginPath();
      ctx.moveTo(s * 0.20, 0);
      ctx.lineTo(-s * 0.05, -s * 0.12);
      ctx.lineTo(-s * 0.22, 0);
      ctx.lineTo(-s * 0.05, s * 0.12);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    } else if (element === 'poison') {
      ctx.fillStyle = COLORS.poison;
      circle(ctx, 0, 0, s * 0.17, COLORS.poison);
      circle(ctx, s * 0.10, -s * 0.06, s * 0.05, COLORS.poison);
    } else if (element === 'blast') {
      ctx.fillStyle = COLORS.blast;
      circle(ctx, 0, 0, s * 0.18, COLORS.blast);
      ctx.fillStyle = '#fff';
      const sp = (t % 0.3) / 0.3;
      circle(ctx, s * 0.06 * Math.cos(sp * 6.28), s * 0.06 * Math.sin(sp * 6.28), s * 0.03, '#fff');
    } else if (element === 'storm') {
      ctx.fillStyle = COLORS.storm;
      ctx.beginPath();
      ctx.moveTo(-s * 0.14, -s * 0.16);
      ctx.lineTo(s * 0.02, -s * 0.02);
      ctx.lineTo(-s * 0.06, 0);
      ctx.lineTo(s * 0.14, s * 0.16);
      ctx.lineTo(s * 0.0, s * 0.02);
      ctx.lineTo(s * 0.08, -s * 0.02);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    } else {
      ctx.fillStyle = COLORS.arcane;
      const spikes = 5, outerR = s * 0.20, innerR = s * 0.09;
      ctx.beginPath();
      for (let i = 0; i < spikes * 2; i++) {
        const r = i % 2 === 0 ? outerR : innerR;
        const a = (Math.PI / spikes) * i - Math.PI / 2;
        const px = Math.cos(a) * r, py = Math.sin(a) * r;
        if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }
    ctx.restore();
  }

  // ---- scenery (core B): a moody dusk bog ----------------------------------

  function sceneryB(ctx, W, H, t, chapter) {
    ctx.save();
    const bandH = H; // caller clips to top 55%
    // dusk sky, warm glow at the horizon
    const sky = ctx.createLinearGradient(0, 0, 0, bandH * 0.55);
    sky.addColorStop(0, COLORS.duskSkyTop);
    sky.addColorStop(0.75, COLORS.duskSkyBot);
    sky.addColorStop(1, COLORS.duskGlow);
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, W, bandH * 0.55);
    // horizon glow band
    const glow = ctx.createLinearGradient(0, bandH * 0.28, 0, bandH * 0.34);
    glow.addColorStop(0, 'rgba(242,166,90,0)');
    glow.addColorStop(1, 'rgba(242,166,90,0.55)');
    ctx.fillStyle = glow;
    ctx.fillRect(0, bandH * 0.24, W, bandH * 0.10);
    // distant bog hills, silhouetted
    ctx.fillStyle = '#3A3352';
    ctx.beginPath();
    ctx.moveTo(0, bandH * 0.32);
    for (let i = 0; i <= 6; i++) {
      const px = (W / 6) * i;
      const py = bandH * 0.32 - Math.sin(i * 1.3 + t * 0.05) * bandH * 0.02 - (i % 2) * bandH * 0.02;
      ctx.lineTo(px, py);
    }
    ctx.lineTo(W, bandH * 0.32);
    ctx.closePath();
    ctx.fill();
    // silhouetted willow trees on hills
    for (let i = 0; i < 5; i++) {
      const tx = (W / 5) * i + W * 0.08;
      const ty = bandH * 0.30;
      const th = bandH * 0.10;
      ctx.strokeStyle = '#2C2740';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(tx, ty);
      ctx.lineTo(tx, ty - th);
      ctx.stroke();
      ctx.fillStyle = '#2C2740';
      ctx.beginPath();
      ctx.ellipse(tx, ty - th, th * 0.5, th * 0.32, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    // drifting fog bands
    ctx.fillStyle = 'rgba(184,198,217,0.25)';
    for (let i = 0; i < 3; i++) {
      const fy = bandH * (0.30 + i * 0.06);
      const shift = ((t * 8 + i * 60) % (W + 120)) - 120;
      ctx.beginPath();
      ctx.ellipse(shift, fy, W * 0.30, bandH * 0.02, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    // ground strip: y maps 30% to 55% of H
    const gTop = bandH * 0.30, gBot = bandH * 0.55;
    const ground = ctx.createLinearGradient(0, gTop, 0, gBot);
    ground.addColorStop(0, COLORS.boggrassShade);
    ground.addColorStop(1, COLORS.boggrass);
    ctx.fillStyle = ground;
    ctx.fillRect(0, gTop, W, gBot - gTop);
    // pond on the left behind the frog
    ctx.fillStyle = COLORS.bogwater;
    ctx.beginPath();
    ctx.ellipse(W * 0.10, gBot - (gBot - gTop) * 0.15, W * 0.09, (gBot - gTop) * 0.12, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = COLORS.ink;
    ctx.lineWidth = 1.5;
    ctx.stroke();
    // reeds and toadstools along the back edge
    for (let i = 0; i < 8; i++) {
      const rx = (W / 8) * i + W * 0.06;
      const ry = gTop + (gBot - gTop) * 0.06;
      if (i % 3 === 0) {
        // toadstool
        ctx.fillStyle = '#EFEFEF';
        ctx.fillRect(rx - 2, ry, 4, 10);
        ctx.fillStyle = COLORS.bad;
        ctx.beginPath();
        ctx.arc(rx, ry, 8, Math.PI, 0);
        ctx.fill();
        ctx.strokeStyle = COLORS.ink;
        ctx.lineWidth = 1.2;
        ctx.stroke();
        ctx.fillStyle = '#fff';
        circle(ctx, rx - 3, ry - 3, 1.5, '#fff');
        circle(ctx, rx + 3, ry - 2, 1.5, '#fff');
      } else {
        ctx.strokeStyle = '#2E4A2E';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(rx, ry + 8);
        ctx.quadraticCurveTo(rx + 4, ry - 6, rx - 2, ry - 14);
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  // ---- portrait -------------------------------------------------------------

  const HERO_LOOK = {
    pip:     { skin: COLORS.skinLeaf, hat: '#5B6CFF', robe: COLORS.robe, species: 'tree' },
    croak:   { skin: '#7FA650',       hat: '#5B6CFF', robe: COLORS.robe, species: 'bullfrog' },
    lily:    { skin: COLORS.gold,     hat: '#5B6CFF', robe: '#C9A83C', species: 'golden' },
    warts:   { skin: '#A07850',       hat: '#5B6CFF', robe: COLORS.robe, species: 'toad' },
    dart:    { skin: '#3F8CFF',       hat: '#5B6CFF', robe: COLORS.robe, species: 'dart' },
    morgana: { skin: '#2B2540',       hat: '#5B6CFF', robe: '#2B2540', species: 'bw' },
  };

  function portrait(canvas, heroId) {
    const ctx = canvas.getContext('2d');
    const W = canvas.width, H = canvas.height;
    ctx.clearRect(0, 0, W, H);
    ctx.save();
    ctx.fillStyle = COLORS.panel;
    ctx.beginPath();
    ctx.arc(W / 2, H / 2, Math.min(W, H) / 2 - 1, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = COLORS.ink;
    ctx.lineWidth = Math.max(1.5, Math.min(W, H) / 24);
    ctx.stroke();
    ctx.restore();
    const look = HERO_LOOK[heroId] || HERO_LOOK.pip;
    const s = Math.min(W, H) * 0.62;
    frogFront(ctx, W / 2, H / 2 + s * 0.30, s, look.skin, look.hat, look.robe, 0, look.species);
  }

  // ---- ingredient card (Slay the Spire style) --------------------------------

  const CARD_META = {
    ember:  { name: 'Ember Salt',    element: 'fire',   stat: 'Burn' },
    frost:  { name: 'Frost Petal',   element: 'ice',    stat: 'Slow' },
    shade:  { name: 'Nightshade',    element: 'poison', stat: 'Poison' },
    blast:  { name: 'Blast Powder',  element: 'blast',  stat: 'Splash' },
    storm:  { name: 'Storm Feather', element: 'storm',  stat: 'Chain' },
    moon:   { name: 'Moon Dust',     element: 'arcane', stat: 'Power' },
    quick:  { name: 'Quicksilver',   element: 'arcane', stat: 'Cast speed' },
    spawn:  { name: 'Frogspawn',     element: 'nature', stat: 'Recruits' },
    dew:    { name: 'Lily Dew',      element: 'dew',    stat: 'Heals per kill' },
  };
  const ELEMENT_COLOR = {
    dew: '#6FE3FF',
    fire: COLORS.fire, ice: COLORS.ice, poison: COLORS.poison, blast: COLORS.blast,
    storm: COLORS.storm, arcane: COLORS.arcane, nature: COLORS.grass,
  };

  // A Slay the Spire style card: element-coloured frame, art window with the
  // ingredient drawing, name banner, tier gem in the top corner, parchment text box.
  function card(ctx, x, y, w, h, type, tier) {
    ctx.save();
    const meta = CARD_META[type] || CARD_META.ember;
    const frameColor = ELEMENT_COLOR[meta.element] || COLORS.gold;
    const r = Math.min(w, h) * 0.06;
    // frame
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
    ctx.fillStyle = darken(frameColor, 0.35);
    ctx.fill();
    ctx.lineWidth = Math.max(1.5, w / 26);
    ctx.strokeStyle = COLORS.ink;
    ctx.stroke();
    // art window
    const pad = w * 0.08;
    const artH = h * 0.5;
    ctx.fillStyle = COLORS.duskSkyBot;
    ctx.fillRect(x + pad, y + pad, w - pad * 2, artH);
    ctx.strokeRect(x + pad, y + pad, w - pad * 2, artH);
    ctx.save();
    ctx.beginPath();
    ctx.rect(x + pad, y + pad, w - pad * 2, artH);
    ctx.clip();
    ingredient(ctx, x + w / 2, y + pad + artH * 0.68, artH * 0.72, type, tier);
    ctx.restore();
    // name banner across the art window bottom
    const bannerY = y + pad + artH - h * 0.05;
    ctx.fillStyle = frameColor;
    ctx.fillRect(x + pad * 0.6, bannerY, w - pad * 1.2, h * 0.09);
    ctx.strokeRect(x + pad * 0.6, bannerY, w - pad * 1.2, h * 0.09);
    ctx.fillStyle = COLORS.ink;
    ctx.font = `700 ${Math.round(h * 0.055)}px Kreon, Georgia, serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(meta.name, x + w / 2, bannerY + h * 0.045);
    // tier gem, top corner
    const gx = x + w * 0.14, gy = y + h * 0.10;
    ctx.fillStyle = TIER_COLOR[tier] || TIER_COLOR[1];
    ctx.beginPath();
    ctx.moveTo(gx, gy - w * 0.07);
    ctx.lineTo(gx + w * 0.07, gy);
    ctx.lineTo(gx, gy + w * 0.07);
    ctx.lineTo(gx - w * 0.07, gy);
    ctx.closePath();
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.fillStyle = COLORS.ink;
    ctx.font = `400 ${Math.round(w * 0.09)}px "Titan One", cursive`;
    ctx.fillText(String(tier), gx, gy + w * 0.01);
    // parchment text box with effect text
    const boxY = y + pad + artH + h * 0.11;
    const boxH = h - (boxY - y) - pad * 0.6;
    ctx.fillStyle = COLORS.parchment;
    ctx.fillRect(x + pad * 0.6, boxY, w - pad * 1.2, boxH);
    ctx.strokeRect(x + pad * 0.6, boxY, w - pad * 1.2, boxH);
    ctx.fillStyle = COLORS.ink;
    ctx.font = `400 ${Math.round(h * 0.05)}px Kreon, Georgia, serif`;
    ctx.fillText(`${meta.stat} +, tier ${tier}`, x + w / 2, boxY + boxH * 0.5);
    ctx.restore();
  }

  // ---- gear icon (Frog screen: slots, storage, sets) -------------------------

  // A simple readable drawing per slot, filled in the set's colour (Meta.SETS[set].color)
  // with a rim in the rarity colour. (x, y) is the ground point, s is the icon height.
  function gearIcon(ctx, x, y, s, slot, rarityId, setId) {
    ctx.save();
    const fill = setColor(setId, COLORS.tier2);
    const rim = RARITY_COLOR[rarityId] || RARITY_COLOR.common;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.arc(x, y - s * 0.40, s * 0.56, 0, Math.PI * 2);
    ctx.fillStyle = rim;
    ctx.fill();
    ctx.strokeStyle = COLORS.ink;
    ctx.lineWidth = Math.max(1.5, s / 18);
    ctx.stroke();
    if (slot === 'hat') {
      ctx.beginPath();
      ctx.moveTo(x - s * 0.28, y);
      ctx.lineTo(x, y - s * 0.72);
      ctx.lineTo(x + s * 0.28, y);
      ctx.closePath();
      ctx.fillStyle = fill;
      ctx.fill();
      ctx.strokeStyle = COLORS.ink;
      ctx.lineWidth = Math.max(1.5, s / 20);
      ctx.stroke();
      ctx.fillStyle = darken(fill, 0.3);
      ctx.beginPath();
      ctx.moveTo(x - s * 0.20, y - s * 0.10);
      ctx.lineTo(x + s * 0.20, y - s * 0.10);
      ctx.lineTo(x + s * 0.26, y);
      ctx.lineTo(x - s * 0.26, y);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    } else if (slot === 'robe') {
      ctx.beginPath();
      ctx.moveTo(x - s * 0.22, y - s * 0.58);
      ctx.quadraticCurveTo(x, y - s * 0.68, x + s * 0.22, y - s * 0.58);
      ctx.lineTo(x + s * 0.32, y);
      ctx.quadraticCurveTo(x, y - s * 0.10, x - s * 0.32, y);
      ctx.closePath();
      ctx.fillStyle = fill;
      ctx.fill();
      ctx.strokeStyle = COLORS.ink;
      ctx.lineWidth = Math.max(1.5, s / 20);
      ctx.stroke();
    } else if (slot === 'staff') {
      ctx.strokeStyle = '#7A5230';
      ctx.lineWidth = s * 0.10;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x, y - s * 0.62);
      ctx.stroke();
      ctx.strokeStyle = COLORS.ink;
      ctx.lineWidth = Math.max(1.2, s / 24);
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x, y - s * 0.62);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(x, y - s * 0.70, s * 0.16, 0, Math.PI * 2);
      ctx.fillStyle = fill;
      ctx.fill();
      ctx.strokeStyle = COLORS.ink;
      ctx.lineWidth = Math.max(1.5, s / 20);
      ctx.stroke();
    } else {
      // amulet: a cord and a round pendant
      ctx.beginPath();
      ctx.arc(x, y - s * 0.36, s * 0.28, 0, Math.PI * 2);
      ctx.strokeStyle = '#8A7A5A';
      ctx.lineWidth = s * 0.06;
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(x, y - s * 0.12, s * 0.20, 0, Math.PI * 2);
      ctx.fillStyle = fill;
      ctx.fill();
      ctx.strokeStyle = COLORS.ink;
      ctx.lineWidth = Math.max(1.5, s / 20);
      ctx.stroke();
    }
    ctx.restore();
  }

  // ---- icon sprite -----------------------------------------------------------

  const ICON_NAMES = [
    'coin', 'gem', 'power', 'ad', 'lock', 'check', 'close', 'pause', 'star', 'crown',
    'chest', 'calendar', 'bag', 'book', 'tower', 'hat', 'shop', 'battle', 'swipe',
    'ing-ember', 'ing-frost', 'ing-shade', 'ing-blast', 'ing-storm', 'ing-moon', 'ing-quick', 'ing-spawn',
  ];

  function iconBody(name) {
    const ink = COLORS.ink;
    switch (name) {
      case 'coin':
        return `<circle cx="12" cy="12" r="9" fill="${COLORS.coin}" stroke="${ink}" stroke-width="1.5"/>
          <ellipse cx="9" cy="15" rx="4" ry="2" fill="${COLORS.grass}" stroke="${ink}" stroke-width="1"/>`;
      case 'gem':
        return `<path d="M12 3 L20 9 L16 21 L8 21 L4 9 Z" fill="${COLORS.gem}" stroke="${ink}" stroke-width="1.5" stroke-linejoin="round"/>`;
      case 'power':
        return `<rect x="10.5" y="4" width="3" height="16" rx="1.5" fill="#8A5A3A" stroke="${ink}" stroke-width="1.5"/>
          <path d="M12 2 L15 6 L12 10 L9 6 Z" fill="${COLORS.gold}" stroke="${ink}" stroke-width="1.5" stroke-linejoin="round"/>`;
      case 'ad':
        return `<rect x="2" y="6" width="20" height="12" rx="4" fill="${COLORS.ad}" stroke="${ink}" stroke-width="1.5"/>
          <path d="M10 9 L16 12 L10 15 Z" fill="#fff" stroke="${ink}" stroke-width="1"/>`;
      case 'lock':
        return `<rect x="5" y="11" width="14" height="10" rx="2" fill="${COLORS.tier1}" stroke="${ink}" stroke-width="1.5"/>
          <path d="M8 11 V8 a4 4 0 0 1 8 0 v3" fill="none" stroke="${ink}" stroke-width="1.5"/>`;
      case 'check':
        return `<circle cx="12" cy="12" r="9" fill="${COLORS.go}" stroke="${ink}" stroke-width="1.5"/>
          <path d="M7 12 L10.5 15.5 L17 8" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round"/>`;
      case 'close':
        return `<circle cx="12" cy="12" r="9" fill="${COLORS.bad}" stroke="${ink}" stroke-width="1.5"/>
          <path d="M8 8 L16 16 M16 8 L8 16" stroke="#fff" stroke-width="2" stroke-linecap="round"/>`;
      case 'pause':
        return `<circle cx="12" cy="12" r="9" fill="${COLORS.panel}" stroke="${ink}" stroke-width="1.5"/>
          <rect x="9" y="8" width="2" height="8" rx="1" fill="${ink}"/>
          <rect x="13" y="8" width="2" height="8" rx="1" fill="${ink}"/>`;
      case 'star':
        return `<path d="M12 3 L14.5 9 L21 9.5 L16 13.7 L17.6 20 L12 16.5 L6.4 20 L8 13.7 L3 9.5 L9.5 9 Z" fill="${COLORS.gold}" stroke="${ink}" stroke-width="1.3" stroke-linejoin="round"/>`;
      case 'crown':
        return `<path d="M4 18 L5 9 L9 13 L12 6 L15 13 L19 9 L20 18 Z" fill="${COLORS.gold}" stroke="${ink}" stroke-width="1.5" stroke-linejoin="round"/>
          <rect x="4" y="18" width="16" height="2.5" fill="${COLORS.gold}" stroke="${ink}" stroke-width="1.2"/>`;
      case 'chest':
        return `<rect x="3" y="11" width="18" height="9" rx="2" fill="${COLORS.buy}" stroke="${ink}" stroke-width="1.5"/>
          <path d="M3 11 Q12 5 21 11" fill="${COLORS.buyShade}" stroke="${ink}" stroke-width="1.5"/>
          <rect x="10.5" y="11" width="3" height="5" fill="${COLORS.gold}" stroke="${ink}" stroke-width="1"/>`;
      case 'calendar':
        return `<rect x="3" y="5" width="18" height="16" rx="2" fill="${COLORS.panel}" stroke="${ink}" stroke-width="1.5"/>
          <rect x="3" y="5" width="18" height="5" fill="${COLORS.bad}" stroke="${ink}" stroke-width="1.5"/>
          <rect x="7" y="3" width="2" height="4" rx="1" fill="${ink}"/>
          <rect x="15" y="3" width="2" height="4" rx="1" fill="${ink}"/>`;
      case 'bag':
        return `<path d="M6 9 L18 9 L19 21 L5 21 Z" fill="${COLORS.buy}" stroke="${ink}" stroke-width="1.5" stroke-linejoin="round"/>
          <path d="M9 9 V7 a3 3 0 0 1 6 0 v2" fill="none" stroke="${ink}" stroke-width="1.5"/>`;
      case 'book':
        return `<path d="M4 5 h8 v15 H4 a1 1 0 0 1 -1 -1 V6 a1 1 0 0 1 1 -1 Z" fill="${COLORS.good}" stroke="${ink}" stroke-width="1.5"/>
          <path d="M20 5 h-8 v15 h8 a1 1 0 0 0 1 -1 V6 a1 1 0 0 0 -1 -1 Z" fill="${COLORS.arcane}" stroke="${ink}" stroke-width="1.5"/>`;
      case 'tower':
        return `<path d="M8 21 L8 11 L6 11 L6 8 L9 8 L9 5 L15 5 L15 8 L18 8 L18 11 L16 11 L16 21 Z" fill="${COLORS.tier3}" stroke="${ink}" stroke-width="1.5" stroke-linejoin="round"/>
          <path d="M9 5 L12 2 L15 5" fill="${COLORS.bad}" stroke="${ink}" stroke-width="1.5" stroke-linejoin="round"/>`;
      case 'hat':
        return `<path d="M6 19 L12 4 L18 19 Z" fill="${COLORS.arcane}" stroke="${ink}" stroke-width="1.5" stroke-linejoin="round"/>
          <rect x="6" y="17" width="12" height="3" rx="1" fill="${COLORS.gold}" stroke="${ink}" stroke-width="1.2"/>`;
      case 'shop':
        return `<path d="M4 9 L4 20 L20 20 L20 9" fill="${COLORS.panel}" stroke="${ink}" stroke-width="1.5"/>
          <path d="M3 9 L5 4 L19 4 L21 9 Z" fill="${COLORS.bad}" stroke="${ink}" stroke-width="1.5" stroke-linejoin="round"/>
          <rect x="10" y="13" width="4" height="7" fill="${COLORS.buy}" stroke="${ink}" stroke-width="1.2"/>`;
      case 'battle':
        return `<path d="M4 4 L20 20 M20 4 L4 20" stroke="#7A5A3A" stroke-width="3" stroke-linecap="round"/>
          <circle cx="12" cy="12" r="2.4" fill="${COLORS.gold}" stroke="${ink}" stroke-width="1.2"/>`;
      case 'swipe':
        return `<path d="M7 13 c0 -5 3 -8 3 -8 v10 M10 6 v9 M13 7 v8 M16 8 v6" fill="none" stroke="${ink}" stroke-width="1.6" stroke-linecap="round"/>
          <path d="M6 15 q6 6 12 0" fill="none" stroke="${ink}" stroke-width="1.6" stroke-linecap="round"/>`;
      case 'ing-ember':
        return `<rect x="8" y="9" width="8" height="10" fill="#D8E8F0" stroke="${ink}" stroke-width="1.5"/>
          <path d="M12 6 q3 4 0 6 q-3 -2 0 -6" fill="${COLORS.fire}" stroke="${ink}" stroke-width="1.2"/>`;
      case 'ing-frost':
        return `<ellipse cx="12" cy="12" rx="5" ry="8" fill="${COLORS.ice}" stroke="${ink}" stroke-width="1.5" transform="rotate(45 12 12)"/>`;
      case 'ing-shade':
        return `<line x1="12" y1="20" x2="12" y2="6" stroke="#3E6B3E" stroke-width="1.5"/>
          <circle cx="9" cy="10" r="3" fill="#4A2F6B" stroke="${ink}" stroke-width="1.2"/>
          <circle cx="14" cy="8" r="3" fill="#4A2F6B" stroke="${ink}" stroke-width="1.2"/>`;
      case 'ing-blast':
        return `<path d="M8 20 Q6 10 12 8 Q18 10 16 20 Z" fill="${COLORS.blast}" stroke="${ink}" stroke-width="1.5"/>
          <path d="M13 8 L15 3" stroke="#7A5A3A" stroke-width="1.5"/>
          <circle cx="15" cy="2.5" r="1.4" fill="${COLORS.fire}"/>`;
      case 'ing-storm':
        return `<path d="M12 3 L16 10 L13 10 L15 20 L8 11 L11 11 Z" fill="${COLORS.storm}" stroke="${ink}" stroke-width="1.5" stroke-linejoin="round"/>`;
      case 'ing-moon':
        return `<path d="M12 3 A9 9 0 1 0 12 21 A7 7 0 1 1 12 3 Z" fill="${COLORS.arcane}" stroke="${ink}" stroke-width="1.5"/>`;
      case 'ing-quick':
        return `<path d="M12 3 Q18 12 12 21 Q6 12 12 3 Z" fill="#C8CDE0" stroke="${ink}" stroke-width="1.5"/>`;
      case 'ing-spawn':
        return `<circle cx="9" cy="13" r="4" fill="rgba(230,245,255,0.9)" stroke="${ink}" stroke-width="1.3"/>
          <circle cx="9" cy="13" r="1.2" fill="${ink}"/>
          <circle cx="15" cy="10" r="4" fill="rgba(230,245,255,0.9)" stroke="${ink}" stroke-width="1.3"/>
          <circle cx="15" cy="10" r="1.2" fill="${ink}"/>
          <circle cx="15" cy="17" r="3" fill="rgba(230,245,255,0.9)" stroke="${ink}" stroke-width="1.3"/>
          <circle cx="15" cy="17" r="1" fill="${ink}"/>`;
      default:
        return '';
    }
  }

  function buildIconSprite() {
    let out = '<svg xmlns="http://www.w3.org/2000/svg" style="display:none">';
    for (const name of ICON_NAMES) {
      out += `<symbol id="i-${name}" viewBox="0 0 24 24">${iconBody(name)}</symbol>`;
    }
    out += '</svg>';
    return out;
  }

  root.Art = {
    COLORS,
    frogSide,
    frogFront,
    ratSide,
    boss,
    ingredient,
    keg,
    glob,
    bolt,
    sceneryB,
    portrait,
    card,
    gearIcon,
    ICON_SPRITE: buildIconSprite(),
  };
})(typeof window !== 'undefined' ? window : this);
