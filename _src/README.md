# Source

`index.html` at the repository root is generated. Edit the files here, then rebuild:

```bash
python3 _src/build.py
```

| File | What it is |
|---|---|
| `app.js` | The module script: text effects, the three.js pipeline, the rocket and the warp jump |
| `extra.css` | Styles added on top of the base page |
| `base.html` | The earlier single-file page. `build.py` takes the content sections and base styles from it |
| `build.py` | Assembles `index.html` from the three files above and applies the content edits |

GitHub Pages skips directories that start with an underscore, so nothing in `_src/` is served.

## Prototypes

`prototypes/ships/` keeps the round where the hero object was chosen. It has three ship designs
(A rocket, B deep-space probe, C delta-wing) and two endings, switchable from a small panel.
The site uses A with the "fly back" ending. See the README in that folder to run it.
