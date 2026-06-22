import type { Provider } from "./types";
import { upworkProvider } from "./upwork";
import { customRssProvider } from "./custom-rss";
import { laborxProvider } from "./laborx";
import { freelancerProvider } from "./freelancer";
import { peoplePerHourProvider } from "./peopleperhour";
import { kworkProvider } from "./kwork";

/**
 * Provider registry. To add a marketplace: implement the Provider interface in
 * providers/<name>.ts and add it to this array. Everything else (the cron
 * loop, matching, dedup, notifications) works automatically.
 *
 * Only providers with `enabled: true` actually run (see enabledProviders).
 * Currently kwork-only: the others are kept registered but disabled.
 */
export const ALL_PROVIDERS: Provider[] = [
  kworkProvider,
  upworkProvider,
  customRssProvider,
  laborxProvider,
  freelancerProvider,
  peoplePerHourProvider,
];

/** Only the providers that are implemented and turned on. */
export const enabledProviders = (): Provider[] =>
  ALL_PROVIDERS.filter((p) => p.enabled);

export type { Provider, Job, ProviderContext } from "./types";
