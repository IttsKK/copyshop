# Contributing

Thanks for wanting to help. copyshop is made by one person, so a little
coordination goes a long way.

## Reporting a problem

Open an [issue](https://github.com/IttsKK/copyshop/issues) with what you did,
what you expected, and what happened. Your copyshop version (Settings → General)
and your system help. A screenshot or the photo's size often helps more than a
description.

## Suggesting a feature

Open an issue, or use [Request a feature](https://getcopyshop.com/request) if
you'd rather not use GitHub. Say what you're trying to make; the best feature
is often a different one from the first idea.

## Pull requests

- **Small fixes** (a bug, a typo, a crash): send a pull request.
- **Anything bigger** (a new effect, a change to how something works): open an
  issue first so we can agree on it before you spend the time.

Before you send it:

```sh
npx tsc -b
npm test
```

Keep the change focused on one thing, and match the code around it. Interface
text is short and plain: say what something does, not how great it is.

By sending a contribution you agree to the terms in [LICENSE](LICENSE),
section 3: it can be used in copyshop, including the official builds.
