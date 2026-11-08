/* Companions: every character shares one face rig (brows, 9 kinds of eyes, cheeks, mouth),
   so all emotions and animations work for each of them. Only the body, colours and extras differ. */
(function (root) {
  const SKIN = '#F6C9A8', HAIR = '#3E2723', INK = 'var(--eye)';
  const W = (d, o) => `<g class="wingL" style="transform-origin:${o}">${d}</g>`;
  const WR = (d, o) => `<g class="wingR" style="transform-origin:${o}">${d}</g>`;

  /* Unusual companions: no animal or person, the whole body shows the mood (colour, glow, motion).
     U is a per-drawing id suffix so several pictures on one page don't share gradients or filters. */
  const ORB = (U) => `
        <defs><radialGradient id="og${U}" cx="38%" cy="32%" r="72%"><stop offset="0" class="s0"/><stop offset=".5" class="s1"/><stop offset="1" class="s2"/></radialGradient>
        <filter id="gl${U}" x="-60%" y="-60%" width="220%" height="220%"><feGaussianBlur stdDeviation="12"/></filter></defs>
        <circle class="aura" cx="120" cy="124" r="80" filter="url(#gl${U})"/>
        <g class="rings"><circle class="ring" cx="120" cy="124" r="78"/><circle class="ring r2" cx="120" cy="124" r="78"/></g>
        <g class="core-g"><circle class="core" cx="120" cy="124" r="74" fill="url(#og${U})"/>
          <g class="swirl"><path d="M64 140 C78 96 132 84 168 106 C140 98 104 110 88 150 Z" fill="#fff" opacity=".18"/><path d="M178 112 C170 156 128 178 86 166 C120 166 150 150 166 116 Z" fill="#fff" opacity=".12"/></g>
          <ellipse cx="92" cy="80" rx="22" ry="12" transform="rotate(-28 92 80)" fill="#fff" opacity=".55"/></g>
        <g class="orbit"><circle cx="120" cy="34" r="6"/></g>`;
  const FLAME = (U) => `
        <defs><filter id="gl${U}" x="-60%" y="-60%" width="220%" height="220%"><feGaussianBlur stdDeviation="10"/></filter></defs>
        <ellipse class="aura" cx="120" cy="150" rx="70" ry="66" filter="url(#gl${U})"/>
        <g class="embers"><circle cx="78" cy="120" r="4"/><circle cx="164" cy="104" r="3.5"/><circle cx="104" cy="70" r="3"/><circle cx="150" cy="150" r="3"/></g>
        <g class="flame-g">
          <path class="fl f1" d="M120 30 C140 66 184 90 182 146 C180 188 154 212 120 212 C86 212 58 188 58 146 C56 110 82 96 92 66 C98 88 108 92 112 82 C116 66 112 48 120 30 Z"/>
          <path class="fl f2" d="M120 78 C136 104 162 118 160 154 C158 184 142 200 120 200 C98 200 82 184 80 154 C78 126 100 116 106 94 C110 106 116 104 118 96 Z"/>
          <path class="fl f3" d="M120 132 C130 146 144 158 142 174 C140 190 131 196 120 196 C109 196 100 190 98 174 C96 160 110 148 120 132 Z"/></g>`;
  const GOO = (U) => `
        <defs><filter id="goo${U}"><feGaussianBlur in="SourceGraphic" stdDeviation="7" result="b"/><feColorMatrix in="b" values="1 0 0 0 0 0 1 0 0 0 0 0 1 0 0 0 0 0 24 -11"/></filter></defs>
        <g class="goo" filter="url(#goo${U})"><circle class="g0" cx="120" cy="140" r="64"/><circle class="g1" cx="120" cy="96" r="38"/><circle class="g2" cx="78" cy="172" r="24"/><circle class="g3" cx="162" cy="170" r="26"/><circle class="g4" cx="120" cy="208" r="13"/><circle class="g5" cx="186" cy="120" r="12"/></g>
        <ellipse cx="88" cy="96" rx="16" ry="9" transform="rotate(-30 88 96)" fill="#fff" opacity=".5"/>`;

  const CHARS = {
    nur:    { name: 'Nur', uz: 'Jonli nur', color: '#4FB3FF', top: 52, hw: 140, kind: 'orb', mouth: 'none', pitch: 1.1, back: ORB },
    olov:   { name: 'Olov', uz: 'Olov ruhi', color: '#FF8A3D', top: 40, hw: 120, kind: 'flame', mouth: 'none', pitch: 1.05, back: FLAME },
    tomchi: { name: 'Tomchi', uz: 'Suyuq tomchi', color: '#38C6A8', top: 60, hw: 132, kind: 'goo', pitch: 1.15, back: GOO },
    qumri: { name: 'Qumri', uz: 'Qushcha', color: '#3BBFB0', top: 58, hw: 150, mouth: 'beak', pitch: 1.25,
      back: () => `
        <path class="tuft" d="M114 62 C108 40 118 30 126 36 C122 44 130 46 134 40 C138 52 128 62 122 64 Z" fill="var(--c-dark)"/>
        ${W('<path d="M66 120 C36 124 28 162 46 180 C58 168 70 150 74 132 Z" fill="var(--c-dark)"/>', '66px 124px')}
        ${WR('<path d="M174 120 C204 124 212 162 194 180 C182 168 170 150 166 132 Z" fill="var(--c-dark)"/>', '174px 124px')}
        <path d="M120 58 C176 58 196 104 196 146 C196 192 162 214 120 214 C78 214 44 192 44 146 C44 104 64 58 120 58 Z" fill="var(--c-main)"/>
        <path d="M120 120 C154 120 170 146 168 172 C164 200 144 208 120 208 C96 208 76 200 72 172 C70 146 86 120 120 120 Z" fill="var(--c-light)" opacity=".92"/>
        <path d="M100 210 l-6 12 M106 211 l0 12 M134 211 l0 12 M140 210 l6 12" stroke="#F2A93B" stroke-width="5" stroke-linecap="round"/>` },

    yurak: { name: 'Yurak', uz: 'Yurakcha', color: '#F2667E', top: 58, hw: 168,
      back: () => `
        ${W('<path d="M44 124 C24 124 18 146 30 156 C38 150 46 142 52 136 Z" fill="var(--c-dark)"/>', '48px 130px')}
        ${WR('<path d="M196 124 C216 124 222 146 210 156 C202 150 194 142 188 136 Z" fill="var(--c-dark)"/>', '192px 130px')}
        <path d="M110 200 l-4 22 M130 200 l4 22" stroke="var(--c-dark)" stroke-width="6" stroke-linecap="round"/>
        <path d="M120 212 C70 182 34 150 34 110 C34 76 58 56 84 56 C102 56 114 66 120 80 C126 66 138 56 156 56 C182 56 206 76 206 110 C206 150 170 182 120 212 Z" fill="var(--c-main)"/>
        <ellipse cx="72" cy="80" rx="14" ry="7" transform="rotate(-35 72 80)" fill="#fff" opacity=".45"/>
        <path class="tuft" d="M120 80 C114 64 124 52 134 58" stroke="var(--c-dark)" stroke-width="5" fill="none" stroke-linecap="round"/>` },

    lola: { name: 'Lola', uz: 'Qiz', color: '#8E6CEF', top: 40, hw: 132, cheeks: [84, 156], pitch: 1.15,
      back: () => `
        <path d="M68 216 C68 184 92 168 120 168 C148 168 172 184 172 216 Z" fill="var(--c-main)"/>
        <path d="M104 168 L120 184 L136 168 Z" fill="var(--c-light)"/>
        ${W(`<path d="M80 184 C66 190 60 200 62 210" stroke="var(--c-main)" stroke-width="13" fill="none" stroke-linecap="round"/><circle cx="62" cy="212" r="8" fill="${SKIN}"/>`, '80px 184px')}
        ${WR(`<path d="M160 184 C174 190 180 200 178 210" stroke="var(--c-main)" stroke-width="13" fill="none" stroke-linecap="round"/><circle cx="178" cy="212" r="8" fill="${SKIN}"/>`, '160px 184px')}
        <path d="M54 112 C54 64 84 42 120 42 C156 42 186 64 186 112 L186 150 C186 162 174 166 166 160 L74 160 C66 166 54 162 54 150 Z" fill="${HAIR}"/>
        <circle class="tuft" cx="120" cy="30" r="16" fill="${HAIR}"/>
        <rect x="108" y="156" width="24" height="16" rx="6" fill="${SKIN}"/>
        <circle cx="60" cy="116" r="10" fill="${SKIN}"/><circle cx="180" cy="116" r="10" fill="${SKIN}"/>
        <ellipse cx="120" cy="114" rx="58" ry="56" fill="${SKIN}"/>
        <path d="M62 100 C64 66 92 52 120 52 C150 52 176 66 178 100 C162 80 140 72 120 74 C100 72 80 80 62 100 Z" fill="${HAIR}"/>` },

    bek: { name: 'Bek', uz: 'Yigit', color: '#2F80ED', top: 46, hw: 132, cheeks: [84, 156], pitch: 0.95, male: true,
      back: () => `
        <path d="M66 216 C66 184 92 168 120 168 C148 168 174 184 174 216 Z" fill="var(--c-main)"/>
        <path d="M100 168 L120 186 L140 168" stroke="var(--c-light)" stroke-width="6" fill="none" stroke-linejoin="round"/>
        ${W(`<path d="M80 184 C66 190 60 200 62 210" stroke="var(--c-main)" stroke-width="14" fill="none" stroke-linecap="round"/><circle cx="62" cy="212" r="8" fill="${SKIN}"/>`, '80px 184px')}
        ${WR(`<path d="M160 184 C174 190 180 200 178 210" stroke="var(--c-main)" stroke-width="14" fill="none" stroke-linecap="round"/><circle cx="178" cy="212" r="8" fill="${SKIN}"/>`, '160px 184px')}
        <rect x="108" y="156" width="24" height="16" rx="6" fill="${SKIN}"/>
        <circle cx="60" cy="116" r="10" fill="${SKIN}"/><circle cx="180" cy="116" r="10" fill="${SKIN}"/>
        <ellipse cx="120" cy="114" rx="58" ry="56" fill="${SKIN}"/>
        <path d="M62 104 C56 66 86 46 122 48 C158 48 186 70 178 104 C172 86 158 76 138 76 C118 78 98 80 84 74 C74 82 66 92 62 104 Z" fill="${HAIR}"/>
        <path class="tuft" d="M108 52 C102 34 124 24 140 34 C128 36 126 44 128 52 Z" fill="${HAIR}"/>` },

    mosh: { name: 'Mosh', uz: 'Mushuk', color: '#F2994A', top: 62, hw: 150, nose: true, pitch: 1.1,
      back: () => `
        <g class="tuft"><path d="M60 96 L64 36 L106 66 Z" fill="var(--c-main)"/><path d="M70 82 L72 52 L94 68 Z" fill="#F7B4C0"/><path d="M180 96 L176 36 L134 66 Z" fill="var(--c-main)"/><path d="M170 82 L168 52 L146 68 Z" fill="#F7B4C0"/></g>
        ${WR('<path d="M188 186 C220 182 226 140 206 126" stroke="var(--c-main)" stroke-width="13" fill="none" stroke-linecap="round"/>', '188px 186px')}
        <path d="M120 58 C176 58 196 104 196 146 C196 192 162 214 120 214 C78 214 44 192 44 146 C44 104 64 58 120 58 Z" fill="var(--c-main)"/>
        <path d="M84 64 l6 16 M104 58 l2 16 M136 58 l-2 16 M156 64 l-6 16" stroke="var(--c-dark)" stroke-width="5" stroke-linecap="round" opacity=".6"/>
        <path d="M120 140 C150 140 164 158 162 178 C158 200 142 206 120 206 C98 206 82 200 78 178 C76 158 90 140 120 140 Z" fill="var(--c-light)"/>
        ${W('<g><ellipse cx="96" cy="206" rx="15" ry="10" fill="var(--c-main)"/><ellipse cx="144" cy="206" rx="15" ry="10" fill="var(--c-main)"/></g>', '120px 206px')}`,
      front: () => `<path d="M72 126 L44 120 M72 134 L44 138 M168 126 L196 120 M168 134 L196 138" stroke="${INK}" stroke-width="2.5" stroke-linecap="round" opacity=".55"/>` },

    bip: { name: 'Bip', uz: 'Robot', color: '#6C8BA6', top: 58, hw: 150, eye: '#7FF3E6', pitch: 0.9, robot: true,
      back: () => `
        <g class="tuft"><path d="M120 58 L120 34" stroke="var(--c-dark)" stroke-width="5" stroke-linecap="round"/><circle cx="120" cy="28" r="9" fill="#F2A93B"/></g>
        ${W('<path d="M48 132 C30 136 24 160 34 172 C42 164 48 152 52 142 Z" fill="var(--c-dark)"/>', '50px 136px')}
        ${WR('<path d="M192 132 C210 136 216 160 206 172 C198 164 192 152 188 142 Z" fill="var(--c-dark)"/>', '190px 136px')}
        <rect x="92" y="202" width="18" height="18" rx="5" fill="var(--c-dark)"/><rect x="130" y="202" width="18" height="18" rx="5" fill="var(--c-dark)"/>
        <rect x="46" y="58" width="148" height="150" rx="42" fill="var(--c-main)"/>
        <rect x="60" y="74" width="120" height="82" rx="28" fill="#13294B"/>
        <circle cx="54" cy="104" r="5" fill="var(--c-dark)"/><circle cx="186" cy="104" r="5" fill="var(--c-dark)"/>
        <rect x="96" y="170" width="48" height="22" rx="8" fill="var(--c-light)"/>
        <circle cx="108" cy="181" r="4" fill="#E25C6B"/><circle cx="120" cy="181" r="4" fill="#F2A93B"/><circle cx="132" cy="181" r="4" fill="#1FA596"/>` },

    bulut: { name: 'Bulut', uz: 'Bulut', color: '#7DB9EA', top: 64, hw: 172, pitch: 1.05,
      back: () => `
        ${W('<circle cx="34" cy="162" r="16" fill="var(--c-dark)"/>', '40px 160px')}
        ${WR('<circle cx="206" cy="160" r="16" fill="var(--c-dark)"/>', '200px 158px')}
        <path d="M66 204 C36 204 22 180 32 160 C18 142 28 112 56 112 C54 82 82 64 108 74 C120 52 156 50 170 74 C196 70 216 94 208 120 C226 132 224 172 198 182 C198 200 182 208 164 204 Z" fill="var(--c-main)"/>
        <path d="M70 196 C52 194 44 180 50 168" stroke="#fff" stroke-width="5" fill="none" stroke-linecap="round" opacity=".5"/>
        <g class="tuft"><path d="M132 210 c-4 7-4 11 0 11 s4-4 0-11z M150 206 c-3 5-3 8 0 8 s3-3 0-8z" fill="#7FC4F0"/></g>` }
  };

  const ACCS = {
    none: { uz: "Yo'q" },
    doppi: { uz: "Do'ppi" },
    glasses: { uz: "Ko'zoynak" },
    bow: { uz: 'Bant' },
    crown: { uz: 'Toj' },
    phones: { uz: 'Quloqchin' }
  };
  const COLORS = ['#3BBFB0', '#F2667E', '#8E6CEF', '#2F80ED', '#F2994A', '#6C8BA6', '#7DB9EA', '#E2B93B', '#4CAF7A', '#D96BC8'];

  function accessory(acc, c) {
    const t = c.top, hw = c.hw;
    if (acc === 'doppi') return `<g class="acc"><path d="M80 ${t + 8} C80 ${t - 24} 160 ${t - 24} 160 ${t + 8} Z" fill="#1F1F24"/>
      <path d="M80 ${t + 8} L160 ${t + 8}" stroke="#3A3A44" stroke-width="5"/>
      ${[96, 120, 144].map((x) => `<path d="M${x} ${t - 10} c-6 4-6 12 0 16 c6-4 6-12 0-16z" fill="#F4F1EA"/>`).join('')}</g>`;
    if (acc === 'glasses') return `<g class="acc"><circle cx="92" cy="106" r="18" fill="#fff" fill-opacity=".12" stroke="#13294B" stroke-width="4"/><circle cx="148" cy="106" r="18" fill="#fff" fill-opacity=".12" stroke="#13294B" stroke-width="4"/><path d="M110 104 Q120 98 130 104" stroke="#13294B" stroke-width="4" fill="none"/></g>`;
    if (acc === 'bow') { const x = 120 - hw * 0.32, y = t + 14; return `<g class="acc"><path d="M${x} ${y} l-22 -14 l2 28 z M${x} ${y} l22 -14 l-2 28 z" fill="#E25C6B"/><circle cx="${x}" cy="${y}" r="6" fill="#B8394A"/></g>`; }
    if (acc === 'crown') return `<g class="acc"><path d="M92 ${t + 6} L88 ${t - 22} L104 ${t - 8} L120 ${t - 28} L136 ${t - 8} L152 ${t - 22} L148 ${t + 6} Z" fill="#F2C94C" stroke="#D9A21B" stroke-width="3" stroke-linejoin="round"/><circle cx="120" cy="${t - 6}" r="4" fill="#E25C6B"/></g>`;
    if (acc === 'phones') { const l = 120 - hw / 2, r = 120 + hw / 2; return `<g class="acc"><path d="M${l + 4} 112 C${l + 4} ${t - 26} ${r - 4} ${t - 26} ${r - 4} 112" stroke="#13294B" stroke-width="8" fill="none" stroke-linecap="round"/><rect x="${l - 8}" y="98" width="20" height="34" rx="9" fill="#E25C6B"/><rect x="${r - 12}" y="98" width="20" height="34" rx="9" fill="#E25C6B"/></g>`; }
    return '';
  }

  const EYES = `
    <g class="e-open"><g class="blinkable"><ellipse cx="92" cy="106" rx="10" ry="13" fill="${INK}"/><ellipse cx="148" cy="106" rx="10" ry="13" fill="${INK}"/><circle cx="96" cy="100" r="4" fill="#fff"/><circle cx="152" cy="100" r="4" fill="#fff"/></g></g>
    <g class="e-smile"><path d="M80 110 Q92 94 104 110 M136 110 Q148 94 160 110" stroke="${INK}" stroke-width="6" fill="none" stroke-linecap="round"/></g>
    <g class="e-star"><path d="M92 92 l4 9 10 1 -8 6 3 10 -9 -6 -9 6 3 -10 -8 -6 10 -1z M148 92 l4 9 10 1 -8 6 3 10 -9 -6 -9 6 3 -10 -8 -6 10 -1z" fill="${INK}"/></g>
    <g class="e-heart"><path d="M92 118 C78 108 80 94 88 94 C92 94 92 98 92 98 C92 98 92 94 96 94 C104 94 106 108 92 118Z M148 118 C134 108 136 94 144 94 C148 94 148 98 148 98 C148 98 148 94 152 94 C160 94 162 108 148 118Z" fill="#E25C6B"/></g>
    <g class="e-side"><g class="blinkable"><ellipse cx="96" cy="102" rx="9" ry="12" fill="${INK}"/><ellipse cx="152" cy="102" rx="9" ry="12" fill="${INK}"/><circle cx="100" cy="96" r="3.5" fill="#fff"/><circle cx="156" cy="96" r="3.5" fill="#fff"/></g></g>
    <g class="e-soft"><g class="blinkable"><path d="M82 106 Q92 116 102 106 Q92 96 82 106Z M138 106 Q148 116 158 106 Q148 96 138 106Z" fill="${INK}"/></g><path d="M80 102 Q92 96 104 102 M136 102 Q148 96 160 102" stroke="${INK}" stroke-width="4" fill="none" stroke-linecap="round"/></g>
    <g class="e-big"><circle cx="92" cy="106" r="15" fill="#fff" stroke="${INK}" stroke-width="4"/><circle cx="148" cy="106" r="15" fill="#fff" stroke="${INK}" stroke-width="4"/><circle cx="92" cy="106" r="6" fill="${INK}"/><circle cx="148" cy="106" r="6" fill="${INK}"/></g>
    <g class="e-sad"><g class="blinkable"><ellipse cx="92" cy="110" rx="9" ry="11" fill="${INK}"/><ellipse cx="148" cy="110" rx="9" ry="11" fill="${INK}"/><circle cx="95" cy="105" r="3.5" fill="#fff"/><circle cx="151" cy="105" r="3.5" fill="#fff"/></g></g>
    <g class="e-laugh"><path d="M80 98 L102 106 L80 114 M160 98 L138 106 L160 114" stroke="${INK}" stroke-width="6" fill="none" stroke-linecap="round" stroke-linejoin="round"/></g>
    <g class="e-closed"><path d="M80 108 Q92 116 104 108 M136 108 Q148 116 160 108" stroke="${INK}" stroke-width="5" fill="none" stroke-linecap="round"/></g>`;
  const MOUTH_BEAK = `<path d="M106 120 Q120 112 134 120 L120 132 Z" fill="#F2A93B"/><path class="beakLow" d="M109 126 L131 126 L120 138 Z" fill="#D98A1E"/>`;
  const MOUTH = `<g class="mouth">
      <path class="m-smile" d="M106 130 Q120 142 134 130" stroke="${INK}" stroke-width="5" fill="none" stroke-linecap="round"/>
      <path class="m-grin" d="M104 128 Q120 152 136 128 Z" fill="${INK}"/>
      <path class="m-frown" d="M108 138 Q120 128 132 138" stroke="${INK}" stroke-width="5" fill="none" stroke-linecap="round"/>
      <ellipse class="m-o" cx="120" cy="136" rx="7" ry="9" fill="${INK}"/>
      <ellipse class="m-talk" cx="120" cy="134" rx="10" ry="9" fill="${INK}"/>
    </g>`;
  const EXTRA = `<g class="extra">
      <g class="hearts"><path d="M40 70 c-8-6-6-14 0-12 c2 1 2 3 2 3 s0-2 2-3 c6-2 8 6-4 12z" fill="#E25C6B"/><path d="M200 60 c-8-6-6-14 0-12 c2 1 2 3 2 3 s0-2 2-3 c6-2 8 6-4 12z" fill="#E25C6B"/><path d="M190 110 c-6-5-5-11 0-9 c2 1 2 2 2 2 s0-1 2-2 c5-2 6 4-4 9z" fill="#E25C6B"/></g>
      <g class="dots"><circle cx="186" cy="52" r="5" fill="var(--muted)"/><circle cx="202" cy="40" r="6" fill="var(--muted)"/><circle cx="220" cy="26" r="7" fill="var(--muted)"/></g>
      <g class="spark"><path d="M34 60 l4 10 10 4 -10 4 -4 10 -4 -10 -10 -4 10 -4z" fill="#F2A93B"/><path d="M204 48 l3 8 8 3 -8 3 -3 8 -3 -8 -8 -3 8 -3z" fill="#F2A93B"/><path d="M212 150 l3 7 7 3 -7 3 -3 7 -3 -7 -7 -3 7 -3z" fill="#1FA596"/></g>
      <path class="tear" d="M84 122 c-4 6-4 10 0 10 s4-4 0-10z" fill="#7FC4F0"/>
      <g class="ear"><path d="M206 96 q10 10 0 20 M216 90 q16 16 0 32" stroke="#1FA596" stroke-width="4" fill="none" stroke-linecap="round"/></g>
      <g class="zz"><text x="176" y="60" font-family="var(--display)" font-size="22" font-weight="800" fill="var(--muted)">z</text><text x="194" y="44" font-family="var(--display)" font-size="16" font-weight="800" fill="var(--muted)">z</text></g>
    </g>`;

  /* cfg: {id, color, acc}; preview=true draws a still face (open eyes + smile) for the picker */
  let uid = 0;
  function svgInner(cfg, preview) {
    const c = CHARS[cfg.id] || CHARS.qumri, U = 'u' + (++uid);
    const [cl, cr] = c.cheeks || [74, 166];
    const eyes = preview ? EYES.split('\n').filter((l) => l.includes('e-open'))[0] : EYES;
    let mouth = c.mouth === 'beak' ? MOUTH_BEAK : c.mouth === 'none' ? '' : MOUTH;
    if (preview && !c.mouth) mouth = `<path d="M106 130 Q120 142 134 130" stroke="${INK}" stroke-width="5" fill="none" stroke-linecap="round"/>`;
    const nose = c.nose ? '<path d="M114 120 L126 120 L120 127 Z" fill="#E86F86"/>' : '';
    return `<ellipse cx="120" cy="228" rx="62" ry="8" fill="var(--line)" opacity=".7"/>
      <g class="float"><g class="body-g">${c.back(U)}
        ${c.kind === 'orb' || c.kind === 'flame' ? '' : `<ellipse class="cheek" cx="${cl}" cy="130" rx="11" ry="7" fill="var(--cheek)"/>
        <ellipse class="cheek" cx="${cr}" cy="130" rx="11" ry="7" fill="var(--cheek)"/>`}
        <g class="look"><path class="brow browL" d="M80 84 Q92 78 104 84" stroke="${INK}" stroke-width="5" fill="none" stroke-linecap="round"/>
          <path class="brow browR" d="M136 84 Q148 78 160 84" stroke="${INK}" stroke-width="5" fill="none" stroke-linecap="round"/>
          <g class="eyes">${eyes}</g></g>
        ${nose}${mouth}${c.front ? c.front() : ''}${accessory(cfg.acc, c)}
      </g></g>${preview ? '' : EXTRA}`;
  }
  function paint(svg, cfg, preview) {
    const c = CHARS[cfg.id] || CHARS.qumri, col = cfg.color || c.color;
    svg.style.setProperty('--c-main', col);
    svg.style.setProperty('--c-dark', `color-mix(in srgb, ${col} 72%, #0b1a33)`);
    svg.style.setProperty('--c-light', `color-mix(in srgb, ${col} 14%, #ffffff)`);
    svg.style.setProperty('--eye', c.eye || '#13294B');
    svg.style.setProperty('--cheek', c.robot ? '#7FF3E6' : '#F49AA6');
    if (c.kind) svg.setAttribute('data-kind', c.kind); else svg.removeAttribute('data-kind');
    svg.innerHTML = svgInner(cfg, preview);
    svg.setAttribute('aria-label', (cfg.name || c.name) + ' (' + c.uz + ')');
  }
  root.QumriChars = { CHARS, ACCS, COLORS, paint };
})(typeof window !== 'undefined' ? window : globalThis);
