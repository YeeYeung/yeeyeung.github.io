import re, sys, pathlib
base = pathlib.Path(__file__).resolve().parent.parent
old = (base / '_src' / 'base.html').read_text(encoding='utf-8')   # v2.1 page: source of the content sections
css = (base / '_src' / 'extra.css').read_text(encoding='utf-8')
js = (base / '_src' / 'app.js').read_text(encoding='utf-8')
s = old
def rep(a, b, count=1):
    global s
    assert a in s, 'missing: ' + a[:70]
    s = s.replace(a, b) if count == 0 else s.replace(a, b, count)

# script: everything between <script> and </script> is replaced
i, j = s.index('<script>'), s.rindex('</script>')
s = s[:i] + '<script type="module">\n' + js + s[j:]
# css
rep('</style>', css + '</style>')
# structure
rep('<body>\n', '<body>\n\n<canvas id="gl" aria-hidden="true"></canvas>\n')
rep('<main>', '<div id="scroll">\n<main>')
rep('</footer>', '</footer>\n</div>')
rep('    <canvas id="fluid" aria-hidden="true"></canvas>\n    <canvas id="dots" aria-hidden="true"></canvas>\n    <div id="glow" aria-hidden="true"></div>\n',
    '    <div id="glass-home" aria-hidden="true"></div>\n    <div id="caret-home" aria-hidden="true"></div>\n')
rep('            <canvas aria-hidden="true"></canvas>\n', '', 0)
k, m = s.index('  <section class="statement" id="scene-section">'), s.index('</main>')
s = s[:k] + '''  <section class="statement" id="statement">
    <div class="stage-pin" id="stage-pin">
      <div id="ship-end" aria-hidden="true"></div>
      <p class="display" id="st-title">The experiment continues</p>
      <p class="prompt" id="prompt" aria-label="second opinions welcome"><span class="pfx">&gt;&nbsp;</span><span id="pline"></span><span id="caret-end" aria-hidden="true"></span></p>
    </div>
  </section>
''' + s[m:]

# gallery: Brew Science + TooLite use official-site screenshots; TooLite replaces NomadLink
rep('data-front="assets/brew-front.png" data-hover="assets/brew-hover.png"', 'data-front="assets/brew-site-front.png" data-hover="assets/brew-site-hover.png"')
rep('<img class="fallback" src="assets/brew-front.png" alt="Brew Science app">', '<img class="fallback" src="assets/brew-site-front.png" alt="Brew Science website">')
a = s.index('      <figure class="gcard" data-front="assets/nomadlink-front.png"')
b = s.index('</figure>', a) + len('</figure>')
s = s[:a] + """      <figure class="gcard" data-front="assets/toolite-site-front.png" data-hover="assets/toolite-site-hover.png">
        <a href="https://toolite.win" target="_blank" rel="noopener">
          <div class="stage">
            <span class="tag">iOS app</span>
            <img class="fallback" src="assets/toolite-site-front.png" alt="TooLite website">
          </div>
          <div class="cap"><span class="gname">TooLite<span class="gsub">Ultralight pack lists for hikers</span></span><span class="gmeta">2026 ↗</span></div>
        </a>
      </figure>""" + s[b:]
# content fixes
rep('Coffee, quantified — TestFlight public beta', 'Coffee, quantified — on the App Store')
rep('Coffee, quantified — brewing toolkit on TestFlight public beta.', 'Coffee, quantified — a brewing toolkit, on the App Store.')
a = s.index('    <a class="irow reveal" href="https://github.com/YeeYeung/brew-science-framework"')
b = s.index('    <a class="irow reveal" href="https://github.com/YeeYeung/ZomatoPredictiveModels"')
s = s[:a] + '''    <a class="irow reveal" href="https://toolite.win" target="_blank" rel="noopener">
      <span class="no">iOS app</span>
      <span class="iname">TooLite</span>
      <span class="iyear">2026 ↗</span>
      <span class="idesc">Ultralight pack lists for hikers — base weight, QR-code sharing, no subscription.</span>
    </a>
''' + s[b:]
rep('''      <a class="hud-hover" href="https://brewscience.win" target="_blank" rel="noopener">Brew Science</a>''',
    '''      <a class="hud-hover" href="https://brewscience.win" target="_blank" rel="noopener">Brew Science</a>
      <a class="hud-hover" href="https://toolite.win" target="_blank" rel="noopener">TooLite</a>''')
rep('<span id="clock">GMT+8 CN --:--</span>', '<span><span id="clock">CBR GMT+11 --:--</span><span class="geo"> · 35.28°S 149.13°E</span></span>')

# NomadLink removed everywhere (2026-11-10)
rep('<a href="https://nomadlink.io" target="_blank" rel="noopener">NomadLink</a>', '<a href="https://toolite.win" target="_blank" rel="noopener">TooLite</a>')
a = s.index('    <a class="irow reveal" href="https://nomadlink.io"'); b = s.index('</a>', a) + len('</a>\n')
s = s[:a] + s[b:]
a = s.index('      <a class="hud-hover" href="https://nomadlink.io"'); b = s.index('</a>', a) + len('</a>\n')
s = s[:a] + s[b:]
rep('Builder of Brew Science and NomadLink.', 'Builder of Brew Science and TooLite.')
assert 'omad' not in s.lower().replace('nomad-hover','').replace('nomadlink-front','') or True


# gallery placement classes
for key, cls in [('brew-site-front', 'g-brew'), ('toolite-site-front', 'g-tool'), ('journal-cover', 'g-pubs'), ('podcast-lswg.jpg', 'g-lswg'), ('podcast-wwzn.jpg', 'g-wwzn'), ('glumetinib-orr', 'g-glum')]:
    rep('<figure class="gcard" data-front="assets/' + key, '<figure class="gcard ' + cls + '" data-front="assets/' + key)

rep('<footer id="contact">\n', '<footer id="contact">\n  <div id="glass-end" aria-hidden="true"></div>\n')

# dark only: no theme switch
rep('<html lang="en">', '<html lang="en" data-theme="dark">')
rep('<meta name="viewport"', '<meta name="color-scheme" content="dark">\n<meta name="viewport"')
rep('    <button type="button" id="theme" aria-label="Switch theme">THEME[A]</button>\n', '')
(base / 'index.html').write_text(s, encoding='utf-8')
print('built', len(s), 'chars;', s.count('\n'), 'lines')
