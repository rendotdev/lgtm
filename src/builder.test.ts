import { describe, expect, it, vi } from "vite-plus/test";
import { build, defineBuilderDeps, type BuilderType } from "./builder.ts";

describe("build", () => {
  it("uses a dependency contract to infer the generated builder", () => {
    const productionDeps = { execute: () => "production" as const };
    const defined = defineBuilderDeps<{ execute: () => string }>(productionDeps);
    const { WidenedDependencyServiceBuilder } = build().service("WidenedDependencyService", {
      config: {},
      deps: defined,
      build({ deps }) {
        return { run: deps.execute };
      },
    });

    const TestService = WidenedDependencyServiceBuilder({
      config: {},
      deps: { execute: () => "test" },
    });

    expect(defined).toBe(productionDeps);
    expect(TestService.run()).toBe("test");
  });

  it("runs an entrypoint through the builder", async () => {
    const execute = vi.fn(async function execute(value: string) {
      return value.toUpperCase();
    });

    const result = await build().entrypoint({
      config: { value: "lgtm" },
      deps: { execute },
      async run({ config, deps }) {
        return await deps.execute(config.value);
      },
    });

    expect(result).toBe("LGTM");
    expect(execute).toHaveBeenCalledWith("lgtm");
  });

  it("builds a named service and a builder for test dependencies", () => {
    const track = vi.fn();
    const { ExampleService, ExampleServiceBuilder } = build().service("ExampleService", {
      config: { prefix: "production" },
      deps: { track },
      build({ config, deps }) {
        return {
          format(params: { readonly value: string }) {
            deps.track(params.value);
            return `${config.prefix}:${params.value}`;
          },
        };
      },
    });

    expect(ExampleService.format({ value: "value" })).toBe("production:value");
    expect(track).toHaveBeenCalledWith("value");

    const TestService: BuilderType<typeof ExampleServiceBuilder> = ExampleServiceBuilder({
      config: { prefix: "test" },
      deps: { track: vi.fn() },
    });
    expect(TestService.format({ value: "value" })).toBe("test:value");
  });

  it("builds a named singleton and a builder", () => {
    const { ExampleSingleton, ExampleSingletonBuilder } = build().singleton("ExampleSingleton", {
      build() {
        return { value: Symbol("example") };
      },
    });

    expect(ExampleSingleton.value).toBeTypeOf("symbol");
    expect(ExampleSingletonBuilder().value).not.toBe(ExampleSingleton.value);
  });

  it("builds named components and routes", () => {
    const { MessageComponent, MessageComponentBuilder } = build().component(
      "MessageComponent",
      function MessageComponent(props: { readonly message: string }) {
        return props.message;
      },
    );
    const { HomeRoute, HomeRouteBuilder } = build().component(
      "HomeRoute",
      function HomeRoute(props: { readonly title: string }) {
        return props.title;
      },
    );

    expect(MessageComponent({ message: "Hello" })).toBe("Hello");
    expect(MessageComponentBuilder()).toBe(MessageComponent);
    expect(HomeRoute({ title: "LGTM" })).toBe("LGTM");
    expect(HomeRouteBuilder()).toBe(HomeRoute);
  });

  it("builds a named hook and a builder for lifecycle fakes", () => {
    const { useValue, useValueBuilder } = build().hook("useValue", {
      config: { prefix: "production" },
      deps: { transform: (value: string) => value.toUpperCase() },
      build({ config, deps }) {
        return function useValue(params: { readonly value: string }) {
          return `${config.prefix}:${deps.transform(params.value)}`;
        };
      },
    });

    expect(useValue({ value: "value" })).toBe("production:VALUE");

    const useValueForTest = useValueBuilder({
      config: { prefix: "test" },
      deps: { transform: (value) => value },
    });
    expect(useValueForTest({ value: "value" })).toBe("test:value");
  });

  it("enforces category names through template literal types", () => {
    const invalidService = build().service(
      // @ts-expect-error Service names end with Service.
      "Example",
      {
        config: {},
        deps: {},
        build() {
          return {
            run(params: {}) {
              return params;
            },
          };
        },
      },
    );
    const validService = build().service("ExampleService", {
      config: {},
      deps: {},
      build() {
        return {
          run(params: {}) {
            return params;
          },
        };
      },
    });
    const invalidSingleton = build().singleton(
      // @ts-expect-error Singleton names end with Singleton.
      "Example",
      { build: () => ({}) },
    );
    const invalidComponent = build().component(
      // @ts-expect-error Component names end with Component or Route.
      "Example",
      function Example() {
        return null;
      },
    );
    const invalidHook = build().hook(
      // @ts-expect-error Hook names start with use.
      "example",
      {
        config: {},
        deps: {},
        build() {
          return function useExample(params: {}) {
            return params;
          };
        },
      },
    );

    expect(invalidService).toBeDefined();
    expect(invalidSingleton).toBeDefined();
    expect(invalidComponent).toBeDefined();
    expect(invalidHook).toBeDefined();
    // @ts-expect-error The returned property is derived from the supplied name.
    expect(validService.WrongService).toBeUndefined();
  });
});
