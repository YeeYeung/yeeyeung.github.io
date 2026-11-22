# Ship prototype (November 2026)

Three candidate hero objects and two endings for the statement section. The live site uses
ship A with the "fly back" ending; B and C are kept here for later.

| | |
|---|---|
| A | Round rocket: glass hull, belt, porthole, three fins |
| B | Deep-space probe: dish antenna, bus, two booms with instruments |
| C | Delta-wing ship: slim fuselage, swept wings, twin nacelles |

The builders are `shipA()`, `shipB()` and `shipC()` in `app.js`. Each returns `{ group, size }`,
where `size` is the model's largest dimension in model units.

## Run it

From a scratch copy of the repository:

```bash
cp _src/prototypes/ships/app.js _src/prototypes/ships/extra.css _src/
```

```bash
python3 _src/build.py
```

```bash
python3 _src/prototypes/ships/serve.py 4178
```

Then open `http://localhost:4178/`. The panel at the top left switches ship and ending; the same
choices work as URL parameters, for example `?ship=b&end=leave`. `serve.py` also accepts
`POST /answers` and writes the panel's choices to `answers.json` next to itself.

Do not commit the rebuilt `index.html` from that scratch copy.
