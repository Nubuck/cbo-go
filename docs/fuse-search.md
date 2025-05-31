# [\#](https://www.fusejs.io/examples.html\#examples) Examples

* * *

## [\#](https://www.fusejs.io/examples.html\#search-string-array) Search String Array

List

JS

Output

```
["Old Man's War", "The Lock Artist"]

```

## [\#](https://www.fusejs.io/examples.html\#search-object-array) Search Object Array

List

JS

Output

```
[\
  {\
    "title": "Old Man's War",\
    "author": "John Scalzi",\
    "tags": ["fiction"]\
  },\
  {\
    "title": "The Lock Artist",\
    "author": "Steve",\
    "tags": ["thriller"]\
  }\
]

```

## [\#](https://www.fusejs.io/examples.html\#nested-search) Nested Search

You can search through nested values with different ways:

- define the path with dot notation ( `.`)
- define the path with array notation ( `[]`)
- Define a per-key `getFn` function

List

JS (dot notation)

JS (array notation)

JS (get function)

Output

```
[\
  {\
    "title": "Old Man's War",\
    "author": {\
      "name": "John Scalzi",\
      "tags": [\
        {\
          "value": "American"\
        }\
      ]\
    }\
  },\
  {\
    "title": "The Lock Artist",\
    "author": {\
      "name": "Steve Hamilton",\
      "tags": [\
        {\
          "value": "English"\
        }\
      ]\
    }\
  }\
]

```

IMPORTANT

The path has to eventually point to a string, otherwise you will not get any results.

## [\#](https://www.fusejs.io/examples.html\#weighted-search) Weighted Search

You can allocate a weight to keys to give them higher (or lower) values in search results. The `weight` value has to be greater than `0`.

List

JS

Output

```
[\
  {\
    "title": "Old Man's War fiction",\
    "author": "John X",\
    "tags": ["war"]\
  },\
  {\
    "title": "Right Ho Jeeves",\
    "author": "P.D. Mans",\
    "tags": ["fiction", "war"]\
  }\
]

```

### [\#](https://www.fusejs.io/examples.html\#default-weight) Default `weight`

When a `weight` isn't provided, it will default to `1`. In the following example, while `author` has been given a weight of `2`, `title` will be assigned a weight of `1`.

```
const fuse = new Fuse(books, {
  keys: [\
    'title', // will be assigned a `weight` of 1\
    {\
      name: 'author',\
      weight: 2\
    }\
  ]
})

```

Note that internally Fuse will normalize the weights to be within `0` and `1` exclusive.

## [\#](https://www.fusejs.io/examples.html\#extended-search) Extended Search

This form of advanced searching allows you to fine-tune results.

White space acts as an **AND** operator, while a single pipe ( `|`) character acts as an **OR** operator. To escape white space, use double quote ex. `="scheme language"` for exact match.

| Token | Match type | Description |
| --- | --- | --- |
| `jscript` | fuzzy-match | Items that fuzzy match `jscript` |
| `=scheme` | exact-match | Items that are `scheme` |
| `'python` | include-match | Items that include `python` |
| `!ruby` | inverse-exact-match | Items that do not include `ruby` |
| `^java` | prefix-exact-match | Items that start with `java` |
| `!^earlang` | inverse-prefix-exact-match | Items that do not start with `earlang` |
| `.js$` | suffix-exact-match | Items that end with `.js` |
| `!.go$` | inverse-suffix-exact-match | Items that do not end with `.go` |

White space acts as an **AND** operator, while a single pipe ( `|`) character acts as an **OR** operator.

List

JS

Output

```
[\
  {\
    "title": "Old Man's War",\
    "author": "John Scalzi"\
  },\
  {\
    "title": "The Lock Artist",\
    "author": "Steve"\
  },\
  {\
    "title": "Artist for Life",\
    "author": "Michelangelo"\
  }\
]

```

**❤️️ Fuse.js? Support its development with a small donation.**

[Donate](https://github.com/sponsors/krisk)