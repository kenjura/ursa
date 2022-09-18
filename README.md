static site generator from MD/wikitext/YML

there are many like it, but this one's mine

# Developing

```npm run serve```

Watches source and meta folder; on change, writes HTML to build folder.

Optional environment variables:
- SOURCE: path to the source folder, default `${cwd}/source`
- META: path to the meta folder, default `${cwd}/meta`
- BUILD: path to the build folder, default `${cwd}/build`

# Running

## Run once, converting source folder into static html

```npm start```

Defaults:
- source: the "source" directory in cwd
- meta: the "meta" directory in cwd
- output: the "build" directory in cwd

This is not very useful. Will make these configurable.