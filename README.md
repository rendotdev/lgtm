# Pi-diff

Pi-diff is a Pi extension for browser-based inline diff review comments.

## Install

Install from GitHub:

```bash
pi install git:github.com/rendotdev/pi-diff
```

This package exposes only `extensions/pi-diff.ts`, so the command above installs the pi-diff extension.

### Install a specific extension

Pi installs git and npm packages at the package level. To load one extension from a package, use package filtering in `~/.pi/agent/settings.json` or project `.pi/settings.json`:

```json
{
  "packages": [
    {
      "source": "git:github.com/rendotdev/pi-diff",
      "extensions": ["+extensions/pi-diff.ts"],
      "skills": [],
      "prompts": [],
      "themes": []
    }
  ]
}
```

For a local checkout, you can point Pi at the single extension file:

```bash
pi -e /absolute/path/to/pi-diff/extensions/pi-diff.ts
```
