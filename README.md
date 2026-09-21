# create-mobilewright

Scaffold a [Mobilewright](https://mobilewright.dev) test project in seconds.

## Usage

```sh
npm init mobilewright@latest
```

Also works with Yarn (`yarn create mobilewright`), pnpm (`pnpm create mobilewright`) and Bun (`bun create mobilewright`). The project's own package manager is detected from its lockfile, so dependencies are installed with the tool you already use.

The CLI walks you through setup and creates a ready-to-run project:

![create-mobilewright screenshot](docs/screenshot.png)

## What you get

```
my-project/
  mobilewright.config.ts   # Device and app configuration
  tests/
    example.spec.ts        # A working test you can run immediately
  package.json
```

## Run your first test

```sh
cd my-project
npx mobilewright test
```

That's it. 

If this is the first time you are running a test on iOS (simulator or real device), you will need to run `npx mobilewright install` to set up the agent on the device.

If something's missing, `npx mobilewright doctor` tells you exactly what to fix.

## Next steps

- [Mobilewright docs](https://mobilewright.dev/docs) — API reference and guides
- [Mobile Next Cloud](https://mobilenext.ai/cloud?utm_source=github&utm_medium=readme&utm_campaign=create-mobilewright&utm_content=next-steps) — Run tests on real devices in the cloud

## License

Apache
