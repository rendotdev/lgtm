import type { ReactNode } from "react";

export type BuilderType<Builder extends (...params: never[]) => unknown> = ReturnType<Builder>;

/**
 * Widens production values to the dependency contract used to infer a generated builder.
 * Taking that builder as the generic would be circular because it does not exist yet.
 */
export function defineBuilderDeps<DependencyContract>(
  deps: DependencyContract,
): DependencyContract {
  return deps;
}

type BuildInput<Config, Deps> = {
  readonly config: Readonly<Config>;
  readonly deps: Readonly<Deps>;
};

type NamedBuild<Name extends string, Value, Builder> = Readonly<
  { [Key in Name]: Value } & {
    [Key in `${Name}Builder`]: Builder;
  }
>;

export function build() {
  return {
    entrypoint<Config, Deps, Output>(definition: {
      readonly config: Config;
      readonly deps: Deps;
      readonly run: (input: BuildInput<Config, Deps>) => Output;
    }): Output {
      return definition.run({ config: definition.config, deps: definition.deps });
    },

    service<
      Name extends `${string}Service`,
      Config,
      Deps,
      Service extends Record<string, (...args: never[]) => unknown>,
    >(
      name: Name,
      definition: {
        readonly config: Config;
        readonly deps: Deps;
        readonly build: (input: BuildInput<Config, Deps>) => Service;
      },
    ): NamedBuild<Name, Service, (input: BuildInput<Config, Deps>) => Service> {
      function builder(input: BuildInput<Config, Deps>) {
        return definition.build(input);
      }

      return {
        [name]: builder({ config: definition.config, deps: definition.deps }),
        [`${name}Builder`]: builder,
      } as NamedBuild<Name, Service, typeof builder>;
    },

    singleton<Name extends `${string}Singleton`, Value>(
      name: Name,
      definition: { readonly build: () => Value },
    ): NamedBuild<Name, Value, () => Value> {
      function builder() {
        return definition.build();
      }

      return {
        [name]: builder(),
        [`${name}Builder`]: builder,
      } as NamedBuild<Name, Value, typeof builder>;
    },

    component<
      Name extends `${string}Component` | `${string}Route`,
      Props extends object,
      Output extends ReactNode,
    >(
      name: Name,
      component: (props: Props) => Output,
    ): NamedBuild<Name, (props: Props) => Output, () => (props: Props) => Output> {
      function builder() {
        return component;
      }

      return {
        [name]: builder(),
        [`${name}Builder`]: builder,
      } as NamedBuild<Name, typeof component, typeof builder>;
    },

    hook<Name extends `use${string}`, Config, Deps, Hook extends (...params: never[]) => unknown>(
      name: Name,
      definition: {
        readonly config: Config;
        readonly deps: Deps;
        readonly build: (input: BuildInput<Config, Deps>) => Hook;
      },
    ): NamedBuild<Name, Hook, (input: BuildInput<Config, Deps>) => Hook> {
      function builder(input: BuildInput<Config, Deps>) {
        return definition.build(input);
      }

      return {
        [name]: builder({ config: definition.config, deps: definition.deps }),
        [`${name}Builder`]: builder,
      } as NamedBuild<Name, Hook, typeof builder>;
    },
  };
}
