declare module "./scripts/assertBuiltChain.mjs" {
  export function builtChainMarker(rawChainId: string | undefined): string;
}

declare module "./scripts/localBundleGuard.mjs" {
  export function assertLocalBundleBuildAllowed(
    env?: NodeJS.ProcessEnv,
    running?: boolean,
  ): void;
}
