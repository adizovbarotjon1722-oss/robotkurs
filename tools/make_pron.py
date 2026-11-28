"""Builds the Uzbek-letter readings of English words from the CMU Pronouncing Dictionary (BSD licence).
usage: python3 tools/make_pron.py path/to/cmudict.dict
writes server/pron.txt.gz (every word) and web/pron.js (the words used in the app's own texts)."""
import sys, re, gzip, os, json
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
V = {'AE':'e','AH':'a','AO':'o','AW':'au','AY':'ay','EH':'e','EY':'ey','IH':'i','IY':'i','OW':'ou','OY':'oy','UH':'u','UW':'u'}
C = {'B':'b','CH':'ch','D':'d','DH':'z','F':'f','G':'g','HH':'h','JH':'j','K':'k','L':'l','M':'m','N':'n','NG':'ng','P':'p','R':'r','S':'s','SH':'sh','T':'t','TH':'s','V':'v','W':'u','Y':'y','Z':'z','ZH':'j'}
def uz(ph):
    out = []
    for i, p in enumerate(ph):
        base, st = re.sub(r'\d', '', p), (p[-1] if p[-1].isdigit() else '')
        nxt = re.sub(r'\d', '', ph[i+1]) if i + 1 < len(ph) else ''
        nxt2 = re.sub(r'\d', '', ph[i+2]) if i + 2 < len(ph) else ''
        # "car", "park" -> a; but "sorry", "borrow" (R starts the next syllable) -> o
        if base == 'AA': out.append('a' if nxt == 'R' and nxt2 not in V and nxt2 not in ('AA', 'ER') else 'o')
        elif base == 'ER': out.append("o'r" if st in '12' else 'ar')
        elif base in V: out.append(V[base])
        else: out.append(C.get(base, ''))
    s = ''.join(out)
    s = s.replace('uu', 'u').replace('yy', 'y').replace('ngk', 'nk').replace('ngg', 'ng')
    return s
words = {}
for line in open(sys.argv[1], encoding='utf-8', errors='ignore'):
    line = line.split('#')[0].strip()
    if not line: continue
    w, *ph = line.split()
    if '(' in w: continue          # keep the first (most common) pronunciation
    words[w] = uz(ph)
# British spellings and compounds the American dictionary lacks: try the American form, then two known halves
def guess(w):
    for a, b in [('our', 'or'), ('yse', 'yze'), ('ise', 'ize'), ('isation', 'ization'), ('llery', 'lry'), ('ogue', 'og'), ('tre', 'ter'), ('ce', 'se'), ('ll', 'l'), ('oghurt', 'ogurt'), ('ae', 'e')]:
        if a in w:
            x = w.replace(a, b)
            if x in words: return words[x]
    for i in range(3, len(w) - 2):
        if w[:i] in words and w[i:] in words: return words[w[:i]] + words[w[i:]]
    return None
text = ''
for p in ['web/core3000.js', 'web/packs.js', 'web/fun.js', 'web/speak.js', 'web/app.js', 'shared/prompts.js']:
    text += open(os.path.join(ROOT, p), encoding='utf-8').read().lower()
used = sorted(set(re.findall(r"[a-z]+(?:'[a-z]+)?", text)))
for w in used:
    if w not in words:
        g = guess(w)
        if g: words[w] = g
sub = {w: words[w] for w in used if w in words}
with gzip.open(os.path.join(ROOT, 'server', 'pron.txt.gz'), 'wt', encoding='utf-8') as f:
    for w, r in words.items(): f.write(w + '\t' + r + '\n')
js = '/* Uzbek-letter readings of English words (built by tools/make_pron.py from the CMU Pronouncing Dictionary). */\nconst PRON = ' + json.dumps(sub, separators=(',', ':'), ensure_ascii=False) + ';\n'
open(os.path.join(ROOT, 'web', 'pron.js'), 'w', encoding='utf-8').write(js)
print('all', len(words), 'app', len(sub), 'js bytes', len(js))
for t in ['sorry','borrow','car','park','jewellery','motorway','analyse','flavour','yoghurt','toothache','deadline','work','water','thank','the','think','cat','hot','car','beautiful','improve','engineer','weather','through','could','enough','yesterday']:
    print(t, words.get(t))
